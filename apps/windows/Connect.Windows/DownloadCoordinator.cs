using System.IO;
using System.Windows;
using Connect.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace Connect.Windows;
internal sealed class DownloadCoordinator : IDisposable
{
    private readonly Window owner;
    private readonly NavigationPolicy policy;
    private readonly CoreWebView2 core;
    private readonly Action<string> status;
    private readonly HashSet<CoreWebView2DownloadOperation> active=[];
    private bool disposed;
    public bool IsActive=>active.Any(operation=>operation.State==CoreWebView2DownloadState.InProgress);
    public DownloadCoordinator(Window owner,NavigationPolicy policy,CoreWebView2 core,Action<string> status)
    {this.owner=owner;this.policy=policy;this.core=core;this.status=status;core.DownloadStarting+=Starting;}
    private void Starting(object? sender,CoreWebView2DownloadStartingEventArgs e)
    {
        if(disposed||!Uri.TryCreate(core.Source,UriKind.Absolute,out var source)||!policy.IsConnect(source)||!Uri.TryCreate(e.DownloadOperation.Uri,UriKind.Absolute,out var uri)||!policy.IsSafeDownload(uri)){e.Cancel=true;return;}
        var deferral=e.GetDeferral();e.Handled=true;
        // Native modal UI runs after WebView2's event returns, avoiding nested
        // message-loop reentrancy in the browser callback.
        owner.Dispatcher.BeginInvoke(()=>{
            using(deferral)
            {
                if(disposed){e.Cancel=true;return;}
                var dialog=new SaveFileDialog{Title="Save file",FileName=SafeName(e.ResultFilePath),OverwritePrompt=true,AddExtension=false,CheckPathExists=true};
                if(dialog.ShowDialog(owner)!=true||disposed){e.Cancel=true;return;}
                e.ResultFilePath=dialog.FileName;
                var operation=e.DownloadOperation;active.Add(operation);
                operation.BytesReceivedChanged+=Progress;operation.StateChanged+=StateChanged;
                status("Downloading "+Path.GetFileName(dialog.FileName)+"…");
            }
        });
    }
    private static string SafeName(string value)
    {
        var filename=Path.GetFileName(value);foreach(var invalid in Path.GetInvalidFileNameChars())filename=filename.Replace(invalid,'_');
        return string.IsNullOrWhiteSpace(filename)?"Connect download":filename;
    }
    private void Progress(object? sender,object e)
    {
        if(disposed||sender is not CoreWebView2DownloadOperation operation||!active.Contains(operation))return;
        status(operation.TotalBytesToReceive is >0?$"Downloading… {Math.Clamp(operation.BytesReceived*100d/operation.TotalBytesToReceive.Value,0,100):0}%":"Downloading…");
    }
    private void StateChanged(object? sender,object e)
    {
        if(disposed||sender is not CoreWebView2DownloadOperation operation||!active.Contains(operation))return;
        if(operation.State==CoreWebView2DownloadState.InProgress)return;
        active.Remove(operation);operation.BytesReceivedChanged-=Progress;operation.StateChanged-=StateChanged;
        status(operation.State==CoreWebView2DownloadState.Completed?"Saved "+Path.GetFileName(operation.ResultFilePath):"Download stopped. You can download the file again from Connect.");
    }
    public void Dispose()
    {
        if(disposed)return;disposed=true;core.DownloadStarting-=Starting;
        foreach(var operation in active){operation.BytesReceivedChanged-=Progress;operation.StateChanged-=StateChanged;if(operation.State==CoreWebView2DownloadState.InProgress)operation.Cancel();}active.Clear();
    }
}
