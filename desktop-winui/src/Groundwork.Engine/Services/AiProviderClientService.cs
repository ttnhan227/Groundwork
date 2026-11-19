using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;

namespace Groundwork.Engine.Services;

public sealed record LlmToolCallRequest(string CallId, string ToolName, IReadOnlyDictionary<string, string> Arguments);

public sealed record LlmAgentLoopResult(
    bool Succeeded,
    string FinalAnswerMarkdown,
    IReadOnlyList<string> ExecutedToolTrace,
    IReadOnlyList<AgentToolCallResult> ToolResults,
    IReadOnlyList<OperationProposal> PendingProposals,
    string? ErrorMessage = null);

/// <summary>
/// Multi-provider tool-calling LLM client for Groundwork Assistant supporting OpenAI-compatible
/// endpoints (OpenAI, Ollama, Mistral, Groq/Custom), Google Gemini, and Anthropic Claude.
/// Only invokes strongly typed registered tools from <see cref="ToolRegistryService"/>.
/// </summary>
public sealed class AiProviderClientService
{
    private const int MaxToolLoopSteps = 6;
    private readonly HttpClient _httpClient;

    public AiProviderClientService(HttpClient? httpClient = null)
    {
        _httpClient = httpClient ?? new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
    }

    public async Task<LlmAgentLoopResult> RunToolLoopAsync(
        AiProviderConfig config,
        string userQuery,
        ToolRegistryService toolRegistry,
        IReadOnlyList<(string User, string Assistant)>? conversationHistory = null,
        IProgress<string>? progress = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(toolRegistry);

        if (!config.IsConfigured)
        {
            return new LlmAgentLoopResult(
                Succeeded: false,
                FinalAnswerMarkdown: string.Empty,
                ExecutedToolTrace: [],
                ToolResults: [],
                PendingProposals: [],
                ErrorMessage: "AI provider is not configured.");
        }

        var provider = config.Provider.Trim().ToLowerInvariant();
        var tools = toolRegistry.GetRegisteredTools();
        var systemPrompt = BuildSystemPrompt(tools);

        try
        {
            return provider switch
            {
                "gemini" => await RunGeminiLoopAsync(config, systemPrompt, userQuery, tools, toolRegistry, conversationHistory, progress, cancellationToken).ConfigureAwait(false),
                "anthropic" => await RunAnthropicLoopAsync(config, systemPrompt, userQuery, tools, toolRegistry, conversationHistory, progress, cancellationToken).ConfigureAwait(false),
                _ => await RunOpenAiCompatibleLoopAsync(config, systemPrompt, userQuery, tools, toolRegistry, conversationHistory, progress, cancellationToken).ConfigureAwait(false)
            };
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            return new LlmAgentLoopResult(
                Succeeded: false,
                FinalAnswerMarkdown: string.Empty,
                ExecutedToolTrace: [],
                ToolResults: [],
                PendingProposals: [],
                ErrorMessage: ex.Message);
        }
    }

    private static string BuildSystemPrompt(IReadOnlyList<AgentToolDefinition> tools)
    {
        return """
            You are the Groundwork Windows System Assistant running locally on the user's PC.
            Rules you MUST follow:
            1. Evidence over assumptions: NEVER guess disk sizes, hardware specs, temperatures, or installed apps. Always call registered diagnostic tools to inspect live Windows state first.
            2. Drill down like a systems engineer: When investigating storage or performance, start broad (e.g., inspect_storage_volumes, inspect_space_hogs) and follow up with targeted tools (e.g., scan_folder_storage on heavy folders like AppData, inspect_installed_apps, inspect_live_processes) until you find the actual root cause.
            3. Safety first: Modifying tools (propose_*) ONLY stage a user-approval proposal with a single-use token; they do NOT execute changes immediately. Never claim an action has been executed if it is awaiting approval.
            4. Transparency: Explicitly separate confirmed telemetry observations from recommendations or elevated/protected boundaries (e.g., System Volume Information / Shadow Copies).
            5. Keep answers concise, structured in Markdown, with exact paths, sizes, and safe next steps.
            """;
    }

    private async Task<LlmAgentLoopResult> RunOpenAiCompatibleLoopAsync(
        AiProviderConfig config,
        string systemPrompt,
        string userQuery,
        IReadOnlyList<AgentToolDefinition> tools,
        ToolRegistryService toolRegistry,
        IReadOnlyList<(string User, string Assistant)>? history,
        IProgress<string>? progress,
        CancellationToken ct)
    {
        var messages = new JsonArray
        {
            new JsonObject { ["role"] = "system", ["content"] = systemPrompt }
        };

        if (history != null)
        {
            foreach (var (u, a) in history.TakeLast(4))
            {
                if (!string.IsNullOrWhiteSpace(u))
                {
                    messages.Add(new JsonObject { ["role"] = "user", ["content"] = u });
                }
                if (!string.IsNullOrWhiteSpace(a))
                {
                    messages.Add(new JsonObject { ["role"] = "assistant", ["content"] = a });
                }
            }
        }

        messages.Add(new JsonObject { ["role"] = "user", ["content"] = userQuery });

        var openAiTools = BuildOpenAiToolsArray(tools);
        var endpoint = NormalizeOpenAiChatUrl(config.Provider, config.Endpoint);

        var trace = new List<string>();
        var results = new List<AgentToolCallResult>();
        var proposals = new List<OperationProposal>();

        for (int step = 0; step < MaxToolLoopSteps; step++)
        {
            ct.ThrowIfCancellationRequested();
            var body = new JsonObject
            {
                ["model"] = config.Model,
                ["messages"] = JsonNode.Parse(messages.ToJsonString()),
                ["tools"] = JsonNode.Parse(openAiTools.ToJsonString()),
                ["tool_choice"] = "auto"
            };

            using var req = new HttpRequestMessage(HttpMethod.Post, endpoint)
            {
                Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json")
            };
            if (!string.IsNullOrWhiteSpace(config.ApiKey))
            {
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.ApiKey.Trim());
            }

            using var resp = await _httpClient.SendAsync(req, ct).ConfigureAwait(false);
            var raw = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
            {
                return new LlmAgentLoopResult(false, string.Empty, trace, results, proposals, $"HTTP {(int)resp.StatusCode}: {Truncate(raw, 300)}");
            }

            using var doc = JsonDocument.Parse(raw);
            if (!doc.RootElement.TryGetProperty("choices", out var choices) || choices.GetArrayLength() == 0)
            {
                return new LlmAgentLoopResult(false, string.Empty, trace, results, proposals, "Provider returned no choices.");
            }

            var messageEl = choices[0].GetProperty("message");
            var assistantText = messageEl.TryGetProperty("content", out var contentEl) && contentEl.ValueKind == JsonValueKind.String
                ? contentEl.GetString() ?? string.Empty
                : string.Empty;

            if (!messageEl.TryGetProperty("tool_calls", out var toolCallsEl) ||
                toolCallsEl.ValueKind != JsonValueKind.Array ||
                toolCallsEl.GetArrayLength() == 0)
            {
                return new LlmAgentLoopResult(true, assistantText.Trim(), trace, results, proposals);
            }

            // Append assistant message with tool_calls
            messages.Add(JsonNode.Parse(messageEl.GetRawText()));

            foreach (var tc in toolCallsEl.EnumerateArray())
            {
                var callId = tc.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? Guid.NewGuid().ToString("N") : Guid.NewGuid().ToString("N");
                var fn = tc.GetProperty("function");
                var toolName = fn.GetProperty("name").GetString() ?? string.Empty;
                var argsJson = fn.TryGetProperty("arguments", out var argEl) ? argEl.GetString() : "{}";
                var args = ParseStringArguments(argsJson);

                var (execResult, payloadForLlm) = await ExecuteSingleToolAsync(toolName, args, toolRegistry, trace, results, proposals, progress, ct).ConfigureAwait(false);
                messages.Add(new JsonObject
                {
                    ["role"] = "tool",
                    ["tool_call_id"] = callId,
                    ["content"] = payloadForLlm
                });
            }
        }

        return new LlmAgentLoopResult(
            Succeeded: true,
            FinalAnswerMarkdown: BuildToolFallbackSummary(results, proposals),
            ExecutedToolTrace: trace,
            ToolResults: results,
            PendingProposals: proposals);
    }

    private async Task<LlmAgentLoopResult> RunGeminiLoopAsync(
        AiProviderConfig config,
        string systemPrompt,
        string userQuery,
        IReadOnlyList<AgentToolDefinition> tools,
        ToolRegistryService toolRegistry,
        IReadOnlyList<(string User, string Assistant)>? history,
        IProgress<string>? progress,
        CancellationToken ct)
    {
        var baseUrl = (string.IsNullOrWhiteSpace(config.Endpoint) ? "https://generativelanguage.googleapis.com" : config.Endpoint).TrimEnd('/');
        var url = $"{baseUrl}/v1beta/models/{Uri.EscapeDataString(config.Model.Trim())}:generateContent?key={Uri.EscapeDataString(config.ApiKey.Trim())}";

        var contents = new JsonArray();
        if (history != null)
        {
            foreach (var (u, a) in history.TakeLast(4))
            {
                if (!string.IsNullOrWhiteSpace(u))
                {
                    contents.Add(new JsonObject
                    {
                        ["role"] = "user",
                        ["parts"] = new JsonArray { new JsonObject { ["text"] = u } }
                    });
                }
                if (!string.IsNullOrWhiteSpace(a))
                {
                    contents.Add(new JsonObject
                    {
                        ["role"] = "model",
                        ["parts"] = new JsonArray { new JsonObject { ["text"] = a } }
                    });
                }
            }
        }

        contents.Add(new JsonObject
        {
            ["role"] = "user",
            ["parts"] = new JsonArray { new JsonObject { ["text"] = userQuery } }
        });

        var decls = BuildGeminiFunctionDeclarations(tools);
        var trace = new List<string>();
        var results = new List<AgentToolCallResult>();
        var proposals = new List<OperationProposal>();

        for (int step = 0; step < MaxToolLoopSteps; step++)
        {
            ct.ThrowIfCancellationRequested();
            var body = new JsonObject
            {
                ["systemInstruction"] = new JsonObject
                {
                    ["parts"] = new JsonArray { new JsonObject { ["text"] = systemPrompt } }
                },
                ["contents"] = JsonNode.Parse(contents.ToJsonString()),
                ["tools"] = new JsonArray
                {
                    new JsonObject { ["functionDeclarations"] = JsonNode.Parse(decls.ToJsonString()) }
                }
            };

            using var req = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json")
            };

            using var resp = await _httpClient.SendAsync(req, ct).ConfigureAwait(false);
            var raw = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
            {
                return new LlmAgentLoopResult(false, string.Empty, trace, results, proposals, $"HTTP {(int)resp.StatusCode}: {Truncate(raw, 300)}");
            }

            using var doc = JsonDocument.Parse(raw);
            if (!doc.RootElement.TryGetProperty("candidates", out var candidates) || candidates.GetArrayLength() == 0)
            {
                return new LlmAgentLoopResult(false, string.Empty, trace, results, proposals, "Gemini returned no candidates.");
            }

            var contentObj = candidates[0].GetProperty("content");
            var parts = contentObj.GetProperty("parts");

            var textParts = new List<string>();
            var functionCalls = new List<(string Name, IReadOnlyDictionary<string, string> Args)>();
            foreach (var part in parts.EnumerateArray())
            {
                if (part.TryGetProperty("text", out var txt) && txt.ValueKind == JsonValueKind.String)
                {
                    textParts.Add(txt.GetString() ?? string.Empty);
                }
                else if (part.TryGetProperty("functionCall", out var fc))
                {
                    var fnName = fc.GetProperty("name").GetString() ?? string.Empty;
                    var args = fc.TryGetProperty("args", out var argsObj) ? ParseStringArguments(argsObj.GetRawText()) : new Dictionary<string, string>();
                    functionCalls.Add((fnName, args));
                }
            }

            if (functionCalls.Count == 0)
            {
                return new LlmAgentLoopResult(true, string.Join("\n", textParts).Trim(), trace, results, proposals);
            }

            contents.Add(JsonNode.Parse(contentObj.GetRawText()));

            var responseParts = new JsonArray();
            foreach (var (fnName, args) in functionCalls)
            {
                var (_, payloadForLlm) = await ExecuteSingleToolAsync(fnName, args, toolRegistry, trace, results, proposals, progress, ct).ConfigureAwait(false);
                responseParts.Add(new JsonObject
                {
                    ["functionResponse"] = new JsonObject
                    {
                        ["name"] = fnName,
                        ["response"] = new JsonObject { ["result"] = payloadForLlm }
                    }
                });
            }

            contents.Add(new JsonObject
            {
                ["role"] = "user",
                ["parts"] = responseParts
            });
        }

        return new LlmAgentLoopResult(true, BuildToolFallbackSummary(results, proposals), trace, results, proposals);
    }

    private async Task<LlmAgentLoopResult> RunAnthropicLoopAsync(
        AiProviderConfig config,
        string systemPrompt,
        string userQuery,
        IReadOnlyList<AgentToolDefinition> tools,
        ToolRegistryService toolRegistry,
        IReadOnlyList<(string User, string Assistant)>? history,
        IProgress<string>? progress,
        CancellationToken ct)
    {
        var baseUrl = (string.IsNullOrWhiteSpace(config.Endpoint) ? "https://api.anthropic.com/v1" : config.Endpoint).TrimEnd('/');
        var url = baseUrl.EndsWith("/messages", StringComparison.OrdinalIgnoreCase) ? baseUrl : $"{baseUrl}/messages";

        var messages = new JsonArray();
        if (history != null)
        {
            foreach (var (u, a) in history.TakeLast(4))
            {
                if (!string.IsNullOrWhiteSpace(u)) messages.Add(new JsonObject { ["role"] = "user", ["content"] = u });
                if (!string.IsNullOrWhiteSpace(a)) messages.Add(new JsonObject { ["role"] = "assistant", ["content"] = a });
            }
        }
        messages.Add(new JsonObject { ["role"] = "user", ["content"] = userQuery });

        var anthropicTools = BuildAnthropicToolsArray(tools);
        var trace = new List<string>();
        var results = new List<AgentToolCallResult>();
        var proposals = new List<OperationProposal>();

        for (int step = 0; step < MaxToolLoopSteps; step++)
        {
            ct.ThrowIfCancellationRequested();
            var body = new JsonObject
            {
                ["model"] = config.Model,
                ["max_tokens"] = 2048,
                ["system"] = systemPrompt,
                ["messages"] = JsonNode.Parse(messages.ToJsonString()),
                ["tools"] = JsonNode.Parse(anthropicTools.ToJsonString())
            };

            using var req = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json")
            };
            req.Headers.Add("x-api-key", config.ApiKey.Trim());
            req.Headers.Add("anthropic-version", "2023-06-01");

            using var resp = await _httpClient.SendAsync(req, ct).ConfigureAwait(false);
            var raw = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
            {
                return new LlmAgentLoopResult(false, string.Empty, trace, results, proposals, $"HTTP {(int)resp.StatusCode}: {Truncate(raw, 300)}");
            }

            using var doc = JsonDocument.Parse(raw);
            var contentArr = doc.RootElement.GetProperty("content");
            var textParts = new List<string>();
            var toolUses = new List<(string Id, string Name, IReadOnlyDictionary<string, string> Args)>();

            foreach (var block in contentArr.EnumerateArray())
            {
                var blockType = block.GetProperty("type").GetString();
                if (blockType == "text")
                {
                    textParts.Add(block.GetProperty("text").GetString() ?? string.Empty);
                }
                else if (blockType == "tool_use")
                {
                    var id = block.GetProperty("id").GetString() ?? Guid.NewGuid().ToString("N");
                    var name = block.GetProperty("name").GetString() ?? string.Empty;
                    var args = block.TryGetProperty("input", out var inputEl) ? ParseStringArguments(inputEl.GetRawText()) : new Dictionary<string, string>();
                    toolUses.Add((id, name, args));
                }
            }

            if (toolUses.Count == 0)
            {
                return new LlmAgentLoopResult(true, string.Join("\n", textParts).Trim(), trace, results, proposals);
            }

            messages.Add(new JsonObject
            {
                ["role"] = "assistant",
                ["content"] = JsonNode.Parse(contentArr.GetRawText())
            });

            var toolResultBlocks = new JsonArray();
            foreach (var (id, name, args) in toolUses)
            {
                var (_, payloadForLlm) = await ExecuteSingleToolAsync(name, args, toolRegistry, trace, results, proposals, progress, ct).ConfigureAwait(false);
                toolResultBlocks.Add(new JsonObject
                {
                    ["type"] = "tool_result",
                    ["tool_use_id"] = id,
                    ["content"] = payloadForLlm
                });
            }

            messages.Add(new JsonObject
            {
                ["role"] = "user",
                ["content"] = toolResultBlocks
            });
        }

        return new LlmAgentLoopResult(true, BuildToolFallbackSummary(results, proposals), trace, results, proposals);
    }

    private static async Task<(AgentToolCallResult Result, string PayloadForLlm)> ExecuteSingleToolAsync(
        string toolName,
        IReadOnlyDictionary<string, string> args,
        ToolRegistryService toolRegistry,
        List<string> trace,
        List<AgentToolCallResult> results,
        List<OperationProposal> proposals,
        IProgress<string>? progress,
        CancellationToken ct)
    {
        var argLabel = args.Count > 0
            ? $"({string.Join(", ", args.Select(kv => $"{kv.Key}={kv.Value}"))})"
            : "()";
        trace.Add($"{toolName}{argLabel}");
        progress?.Report($"Running {toolName}{argLabel}...");

        var res = await toolRegistry.ExecuteToolAsync(new AgentToolCallRequest(toolName, args), ct).ConfigureAwait(false);
        results.Add(res);

        if (res.PendingProposal is { } prop &&
            !proposals.Any(p => string.Equals(p.OperationTypeId, prop.OperationTypeId, StringComparison.OrdinalIgnoreCase) &&
                                string.Equals(p.TargetDescription, prop.TargetDescription, StringComparison.OrdinalIgnoreCase)))
        {
            proposals.Add(prop);
        }

        // Bound JSON size sent back to model context while keeping full structured findings
        var structured = res.StructuredDataJson.Length > 12_000
            ? res.StructuredDataJson[..12_000] + "... [truncated]"
            : res.StructuredDataJson;

        var llmPayload = JsonSerializer.Serialize(new
        {
            tool = res.ToolName,
            succeeded = res.Succeeded,
            is_modifying_proposal_awaiting_approval = res.IsModifyingProposal,
            summary = res.SummaryText,
            data = structured
        });

        return (res, llmPayload);
    }

    private static JsonArray BuildOpenAiToolsArray(IReadOnlyList<AgentToolDefinition> tools)
    {
        var arr = new JsonArray();
        foreach (var t in tools)
        {
            arr.Add(new JsonObject
            {
                ["type"] = "function",
                ["function"] = new JsonObject
                {
                    ["name"] = t.Name,
                    ["description"] = t.Description,
                    ["parameters"] = BuildJsonSchemaObject(t.Parameters)
                }
            });
        }
        return arr;
    }

    private static JsonArray BuildGeminiFunctionDeclarations(IReadOnlyList<AgentToolDefinition> tools)
    {
        var arr = new JsonArray();
        foreach (var t in tools)
        {
            arr.Add(new JsonObject
            {
                ["name"] = t.Name,
                ["description"] = t.Description,
                ["parameters"] = BuildJsonSchemaObject(t.Parameters)
            });
        }
        return arr;
    }

    private static JsonArray BuildAnthropicToolsArray(IReadOnlyList<AgentToolDefinition> tools)
    {
        var arr = new JsonArray();
        foreach (var t in tools)
        {
            arr.Add(new JsonObject
            {
                ["name"] = t.Name,
                ["description"] = t.Description,
                ["input_schema"] = BuildJsonSchemaObject(t.Parameters)
            });
        }
        return arr;
    }

    private static JsonObject BuildJsonSchemaObject(IReadOnlyList<AgentToolParameter> parameters)
    {
        var props = new JsonObject();
        var required = new JsonArray();
        foreach (var p in parameters)
        {
            var jsonType = p.Type.Equals("integer", StringComparison.OrdinalIgnoreCase) ? "string" :
                           (p.Type.Equals("boolean", StringComparison.OrdinalIgnoreCase) ? "string" : "string");
            props[p.Name] = new JsonObject
            {
                ["type"] = jsonType,
                ["description"] = p.Description
            };
            if (p.IsRequired)
            {
                required.Add(p.Name);
            }
        }

        var schema = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = props
        };
        if (required.Count > 0)
        {
            schema["required"] = required;
        }
        return schema;
    }

    private static Dictionary<string, string> ParseStringArguments(string? rawJson)
    {
        var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(rawJson))
        {
            return dict;
        }

        try
        {
            using var doc = JsonDocument.Parse(rawJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
            {
                return dict;
            }
            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                dict[prop.Name] = prop.Value.ValueKind switch
                {
                    JsonValueKind.String => prop.Value.GetString() ?? string.Empty,
                    JsonValueKind.Number => prop.Value.GetRawText(),
                    JsonValueKind.True => "true",
                    JsonValueKind.False => "false",
                    JsonValueKind.Null => string.Empty,
                    _ => prop.Value.GetRawText()
                };
            }
        }
        catch { }

        return dict;
    }

    private static string NormalizeOpenAiChatUrl(string provider, string endpoint)
    {
        var baseUrl = string.IsNullOrWhiteSpace(endpoint)
            ? (provider == "ollama" ? "http://127.0.0.1:11434/v1" : "https://api.openai.com/v1")
            : endpoint.Trim().TrimEnd('/');

        if (baseUrl.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase))
        {
            return baseUrl;
        }

        if (provider == "ollama" && !baseUrl.EndsWith("/v1", StringComparison.OrdinalIgnoreCase))
        {
            return $"{baseUrl}/v1/chat/completions";
        }

        return $"{baseUrl}/chat/completions";
    }

    private static string BuildToolFallbackSummary(
        IReadOnlyList<AgentToolCallResult> results,
        IReadOnlyList<OperationProposal> proposals)
    {
        var sb = new StringBuilder();
        sb.AppendLine("### Groundwork Investigation Findings");
        foreach (var r in results)
        {
            sb.AppendLine($"- **{r.ToolName}**: {r.SummaryText}");
        }
        if (proposals.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("#### Prepared Safe Operations (Awaiting Approval)");
            foreach (var p in proposals)
            {
                sb.AppendLine($"- **{p.DisplayName}**: {p.ProposedChangeExplanation}");
            }
        }
        return sb.ToString().Trim();
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max] + "...";
}
