using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Groundwork.Desktop.Controls;

public sealed partial class MetricPill : UserControl
{
    public static readonly DependencyProperty TextProperty =
        DependencyProperty.Register(nameof(Text), typeof(string), typeof(MetricPill), new PropertyMetadata(string.Empty, (d, e) =>
        {
            if (d is MetricPill pill && e.NewValue is string val) pill.PillLabel.Text = val;
        }));

    public static readonly DependencyProperty GlyphProperty =
        DependencyProperty.Register(nameof(Glyph), typeof(string), typeof(MetricPill), new PropertyMetadata("\uE946", (d, e) =>
        {
            if (d is MetricPill pill && e.NewValue is string val) pill.PillIcon.Glyph = val;
        }));

    public string Text
    {
        get => (string)GetValue(TextProperty);
        set => SetValue(TextProperty, value);
    }

    public string Glyph
    {
        get => (string)GetValue(GlyphProperty);
        set => SetValue(GlyphProperty, value);
    }

    public MetricPill()
    {
        this.InitializeComponent();
    }
}
