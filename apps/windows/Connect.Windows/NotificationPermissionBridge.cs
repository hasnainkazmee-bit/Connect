using System.Text.Json;
using Connect.Core;
using Microsoft.Web.WebView2.Core;
namespace Connect.Windows;

// Page scripts can request permission only after input captured in an isolated
// JavaScript world. ExecuteScriptAsync and synthetic DOM clicks cannot mint it.
internal sealed class NotificationPermissionBridge : IDisposable
{
    private const string World="connectNotificationPermissions";
    private const string Binding="connectNotificationPermission";
    private readonly CoreWebView2 core;
    private readonly NavigationPolicy policy;
    private readonly Action<string> granted;
    private readonly HashSet<int> contexts=[];
    private readonly List<CoreWebView2DevToolsProtocolEventReceiver> receivers=[];
    private bool disposed;
    public NotificationPermissionBridge(CoreWebView2 core,NavigationPolicy policy,Action<string> granted){this.core=core;this.policy=policy;this.granted=granted;}
    public async Task InitializeAsync()
    {
        Listen("Runtime.executionContextCreated",ContextCreated);
        Listen("Runtime.executionContextsCleared",(_,_)=>contexts.Clear());
        Listen("Runtime.bindingCalled",BindingCalled);
        await core.CallDevToolsProtocolMethodAsync("Runtime.enable","{}");
        await core.CallDevToolsProtocolMethodAsync("Runtime.addBinding",JsonSerializer.Serialize(new{name=Binding,executionContextName=World}));
        var origin=JsonSerializer.Serialize(policy.ConnectOrigin.GetLeftPart(UriPartial.Authority));
        var script="(()=>{if(window!==top||window.opener||location.origin!=="+origin+")return;let until=0;const input=e=>{if(e.isTrusted)until=performance.now()+1000};addEventListener('click',input,true);addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')input(e)},true);addEventListener('connect:native-notification-permission',e=>{const id=e.detail?.requestId;if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)||performance.now()>until||!until)return;until=0;globalThis."+Binding+"(JSON.stringify({requestId:id}))})})()";
        await core.CallDevToolsProtocolMethodAsync("Page.addScriptToEvaluateOnNewDocument",JsonSerializer.Serialize(new{source=script,worldName=World}));
    }
    private void Listen(string name,EventHandler<CoreWebView2DevToolsProtocolEventReceivedEventArgs> callback){var receiver=core.GetDevToolsProtocolEventReceiver(name);receiver.DevToolsProtocolEventReceived+=callback;receivers.Add(receiver);}
    private void ContextCreated(object? sender,CoreWebView2DevToolsProtocolEventReceivedEventArgs args)
    {
        if(disposed)return;
        try{using var json=JsonDocument.Parse(args.ParameterObjectAsJson);var context=json.RootElement.GetProperty("context");if(context.GetProperty("name").GetString()==World&&Uri.TryCreate(context.GetProperty("origin").GetString(),UriKind.Absolute,out var origin)&&policy.IsConnect(origin))contexts.Add(context.GetProperty("id").GetInt32());}catch(JsonException){}catch(InvalidOperationException){}
    }
    private void BindingCalled(object? sender,CoreWebView2DevToolsProtocolEventReceivedEventArgs args)
    {
        if(disposed)return;
        try{using var json=JsonDocument.Parse(args.ParameterObjectAsJson);var value=json.RootElement;if(value.GetProperty("name").GetString()!=Binding||!contexts.Contains(value.GetProperty("executionContextId").GetInt32()))return;using var payload=JsonDocument.Parse(value.GetProperty("payload").GetString()??"{}");if(payload.RootElement.TryGetProperty("requestId",out var id)&&Guid.TryParse(id.GetString(),out _))granted(id.GetString()!);}catch(JsonException){}catch(InvalidOperationException){}
    }
    public void Reset()=>contexts.Clear();
    public void Dispose(){disposed=true;contexts.Clear();receivers.Clear();}
}
