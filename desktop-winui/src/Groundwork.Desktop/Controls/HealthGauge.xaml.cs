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
    }

    private static void OnValueChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is HealthGauge gauge && e.NewValue is double val)
        {
            gauge.ValueRing.Value = Math.Clamp(val, 0, 100);
            gauge.ScoreText.Text = $"{Math.Round(val)}%";
            
            // Adjust color dynamically
            if (val >= 80)
            {
                gauge.ValueRing.Foreground = (Brush)Application.Current.Resources["GwSignalGreenBrush"];
            }
            else if (val >= 50)
            {
                gauge.ValueRing.Foreground = (Brush)Application.Current.Resources["GwAmberBrush"];
            }
            else
            {
                gauge.ValueRing.Foreground = (Brush)Application.Current.Resources["GwDangerBrush"];
            }
        }
    }

    private static void OnLabelChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        if (d is HealthGauge gauge && e.NewValue is string lbl)
        {
            gauge.LabelText.Text = lbl;
        }
    }
}
