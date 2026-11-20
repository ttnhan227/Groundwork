using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace Groundwork.Desktop.Controls;

public sealed partial class HealthGauge : UserControl
{
    public static readonly DependencyProperty ValueProperty =
        DependencyProperty.Register(nameof(Value), typeof(double), typeof(HealthGauge), new PropertyMetadata(100.0, OnValueChanged));

    public static readonly DependencyProperty StatusLabelProperty =
        DependencyProperty.Register(nameof(StatusLabel), typeof(string), typeof(HealthGauge), new PropertyMetadata("Healthy", OnLabelChanged));

    public double Value
    {
        get => (double)GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    public string StatusLabel
    {
        get => (string)GetValue(StatusLabelProperty);
        set => SetValue(StatusLabelProperty, value);
    }

    public HealthGauge()
    {
        this.InitializeComponent();
        this.ActualThemeChanged += (_, _) => UpdateRingColor(Value);
    }

    private static void OnValueChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is HealthGauge gauge && e.NewValue is double val)
        {
            gauge.ValueRing.Value = Math.Clamp(val, 0, 100);
            gauge.ScoreText.Text = $"{Math.Round(val)}%";
            gauge.UpdateRingColor(val);
            gauge.UpdateAutomationName();
        }
    }

    private void UpdateRingColor(double val)
    {
        string key = val >= 80 ? "GwSignalGreenBrush" : (val >= 50 ? "GwAmberBrush" : "GwDangerBrush");
        ValueRing.Foreground = MainWindow.ResolveThemeBrush(this, key);
    }

    private void UpdateAutomationName()
    {
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(
            this,
            $"PC Health {Math.Round(Value)} percent, {StatusLabel}");
    }

    private static void OnLabelChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is HealthGauge gauge && e.NewValue is string lbl)
        {
            gauge.LabelText.Text = lbl;
            gauge.UpdateAutomationName();
        }
    }
}
