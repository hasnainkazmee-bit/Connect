using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;

namespace Connect.Windows;

internal static class NativeControls
{
    public static TextBlock Symbol(string glyph, double size=17) => new() { Text=glyph, FontFamily=new FontFamily("Segoe Fluent Icons"), FontSize=size, VerticalAlignment=VerticalAlignment.Center };
    public static Button Button(string label, string? glyph=null)
    {
        var button=new Button { MinHeight=36, MinWidth=36, Padding=new Thickness(10,6,10,6), Margin=new Thickness(2), ToolTip=label };
        button.Content=glyph is null ? label : Symbol(glyph);
        AutomationProperties.SetName(button,label);
        return button;
    }
    public static void InstallNavigationStyle(Window window)
    {
        var style=new Style(typeof(ListBoxItem));
        style.Setters.Add(new Setter(Control.PaddingProperty,new Thickness(14,11,14,11)));
        style.Setters.Add(new Setter(FrameworkElement.MarginProperty,new Thickness(6,3,6,3)));
        style.Setters.Add(new Setter(Control.HorizontalContentAlignmentProperty,HorizontalAlignment.Stretch));
        style.Setters.Add(new Setter(Control.BackgroundProperty,Brushes.Transparent));
        style.Setters.Add(new Setter(Control.BorderBrushProperty,Brushes.Transparent));
        style.Setters.Add(new Setter(Control.BorderThicknessProperty,new Thickness(2)));
        var border=new FrameworkElementFactory(typeof(Border));
        border.SetValue(Border.CornerRadiusProperty,new CornerRadius(8));
        border.SetBinding(Border.BorderBrushProperty,new System.Windows.Data.Binding("BorderBrush"){RelativeSource=new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent)});
        border.SetBinding(Border.BorderThicknessProperty,new System.Windows.Data.Binding("BorderThickness"){RelativeSource=new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent)});
        border.SetBinding(Border.BackgroundProperty,new System.Windows.Data.Binding("Background"){RelativeSource=new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent)});
        border.SetBinding(Border.PaddingProperty,new System.Windows.Data.Binding("Padding"){RelativeSource=new System.Windows.Data.RelativeSource(System.Windows.Data.RelativeSourceMode.TemplatedParent)});
        var presenter=new FrameworkElementFactory(typeof(ContentPresenter));border.AppendChild(presenter);
        style.Setters.Add(new Setter(Control.TemplateProperty,new ControlTemplate(typeof(ListBoxItem)){VisualTree=border}));
        var selected=new Trigger {Property=ListBoxItem.IsSelectedProperty,Value=true};
        selected.Setters.Add(new Setter(Control.BackgroundProperty,new DynamicResourceExtension("Selection")));
        selected.Setters.Add(new Setter(Control.ForegroundProperty,new DynamicResourceExtension("SelectionInk")));
        style.Triggers.Add(selected);
        var focus=new Trigger {Property=UIElement.IsKeyboardFocusWithinProperty,Value=true};
        focus.Setters.Add(new Setter(Control.BorderBrushProperty,new DynamicResourceExtension("Accent")));
        style.Triggers.Add(focus);
        window.Resources["NavigationItem"]=style;
    }
}
