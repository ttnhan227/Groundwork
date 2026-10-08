import { useEffect, useState } from "react";
import { api } from "../../services/api";

export function BackgroundTaskStatus({active, onNavigate}: {active: string; onNavigate: (tab: string) => void}) {
  const [task, setTask] = useState<{id: string; tab: string; phase: string}>();
  useEffect(() => {
    let mounted = true, inFlight = false;
    let tracked: {id: string; tab: string} | undefined;
    let finished = false;
    const poll = async () => {
      if (inFlight) return;
      const answer = sessionStorage.getItem("groundwork-assistant-job");
      const groups = sessionStorage.getItem("groundwork-collection-job");
      const pending = answer ? {id: answer, tab: "assistant"} : groups ? {id: groups, tab: "collections"} : undefined;
      if (pending && pending.id !== tracked?.id) {tracked = pending; finished = false; if(mounted) setTask({...tracked, phase: "running"});}
      if (!tracked || finished) return;
      inFlight = true;
      try {
        const job = await api.assistantJob(tracked.id);
        if (!mounted) return;
        setTask({...tracked, phase: job.status});
        finished = job.status !== "running";
      } catch {if (mounted) {setTask({...tracked, phase: "error"}); finished = true;}}
      finally {inFlight = false;}
    };
    void poll();
    const timer = setInterval(poll, 1000);
    return () => {mounted = false; clearInterval(timer);};
  }, []);
  useEffect(() => {if(task && active === task.tab && task.phase !== "running") setTask(undefined);}, [active, task?.id, task?.phase]);
  if (!task || active === task.tab) return null;
  const working = task.phase === "running";
  const ready = task.phase === "complete";
  return <div className={`desktop-activity ${ready ? "is-ready" : ""}`} role="status">
    {working && <span className="gw-loading-spinner" aria-hidden="true"/>}
    <strong>{working ? "Your AI task is in progress" : ready ? task.tab === "assistant" ? "Your answer is ready" : "Your suggested groups are ready" : "AI task stopped"}</strong>
    <span>{working ? "You can keep browsing your files." : ready ? "Open the result when you’re ready." : "Return to the task to see what happened."}</span>
    <button onClick={() => {onNavigate(task.tab); if(!working) setTask(undefined);}}>{ready ? "Review result" : "Return to task"}</button>
    {!working && <button aria-label="Dismiss AI task notification" onClick={() => setTask(undefined)}>Dismiss</button>}
  </div>;
}
