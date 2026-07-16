using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;

namespace YNXBrowser.Windows;
public partial class MainWindow:Window {
 record TabState(Guid Id,string Url,string Title,bool Private);
 sealed class RuntimeTab(TabState state,WebView2 view){public TabState State=state;public readonly WebView2 View=view;}
 readonly List<RuntimeTab> all=[];
 readonly string state=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"YNXBrowser","state.json");
 bool refreshing;
 public MainWindow(){InitializeComponent();Loaded+=async(_,_)=>await Restore();}
 async Task Open(string url,bool privacy){
  var id=Guid.NewGuid();
  var folder=privacy?Path.Combine(Path.GetTempPath(),"ynx-private",id.ToString()):null;
  var env=await CoreWebView2Environment.CreateAsync(userDataFolder:folder,options:privacy?new CoreWebView2EnvironmentOptions("--inprivate"):null);
  var view=new WebView2();await view.EnsureCoreWebView2Async(env);view.CoreWebView2.Settings.AreDefaultScriptDialogsEnabled=false;
  var runtime=new RuntimeTab(new(id,url,privacy?"Private tab":"New tab",privacy),view);all.Add(runtime);
  view.CoreWebView2.NavigationCompleted+=(_,_)=>{runtime.State=runtime.State with{Url=view.Source?.ToString()??runtime.State.Url,Title=view.CoreWebView2.DocumentTitle};Security.Text=view.Source?.Scheme=="https"?"HTTPS transport · certificate validation handled by Chromium/WebView2":"Not HTTPS · connection is not encrypted";Refresh();Save();};
  view.CoreWebView2.ProcessFailed+=(_,_)=>{Security.Text="Renderer crashed · reload available; normal tabs recover on restart";view.Reload();};
  view.CoreWebView2.PermissionRequested+=(_,e)=>e.State=MessageBox.Show($"Allow {e.PermissionKind} for exact origin {e.Uri}?","Site permission",MessageBoxButton.YesNo)==MessageBoxResult.Yes?CoreWebView2PermissionState.Allow:CoreWebView2PermissionState.Deny;
  view.CoreWebView2.DownloadStarting+=(_,e)=>{if(MessageBox.Show($"Download {e.ResultFilePath}?\nPrivate downloads create normal files outside private mode.","Download review",MessageBoxButton.YesNo)!=MessageBoxResult.Yes)e.Cancel=true;};
  view.CoreWebView2.NewWindowRequested+=(_,e)=>{e.Handled=true;_=Open(e.Uri,false);};view.CoreWebView2.Navigate(url);Show(id);Save();
 }
 void Show(Guid id){Content.Children.Clear();var item=all.First(x=>x.State.Id==id);Content.Children.Add(item.View);Tabs.SelectedIndex=all.IndexOf(item);Address.Text=item.State.Url;Refresh();}
 void Refresh(){refreshing=true;Tabs.ItemsSource=all.Select(x=>$"{(x.State.Private?"Private · ":"")}{x.State.Title}").ToList();refreshing=false;}
 async Task Restore(){try{Directory.CreateDirectory(Path.GetDirectoryName(state)!);var values=JsonSerializer.Deserialize<List<TabState>>(await File.ReadAllTextAsync(state))??[];foreach(var value in values.Where(x=>!x.Private))await Open(value.Url,false);}catch{}if(all.Count==0)await Open("http://127.0.0.1:4313",false);}
 void Save(){try{Directory.CreateDirectory(Path.GetDirectoryName(state)!);File.WriteAllText(state,JsonSerializer.Serialize(all.Where(x=>!x.State.Private).Select(x=>x.State)));}catch{}}
 RuntimeTab Current=>all[Math.Max(0,Tabs.SelectedIndex)];
 void Back(object s,RoutedEventArgs e){if(Current.View.CanGoBack)Current.View.GoBack();}void Forward(object s,RoutedEventArgs e){if(Current.View.CanGoForward)Current.View.GoForward();}void Reload(object s,RoutedEventArgs e)=>Current.View.Reload();async void NewTab(object s,RoutedEventArgs e)=>await Open("http://127.0.0.1:4313",false);async void NewPrivate(object s,RoutedEventArgs e)=>await Open("http://127.0.0.1:4313",true);
 void Bookmark(object s,RoutedEventArgs e)=>File.AppendAllText(Path.Combine(Path.GetDirectoryName(state)!,"bookmarks.jsonl"),JsonSerializer.Serialize(Current.State)+Environment.NewLine);
 void TabChanged(object s,System.Windows.Controls.SelectionChangedEventArgs e){if(!refreshing&&Tabs.SelectedIndex>=0)Show(all[Tabs.SelectedIndex].State.Id);}
 void AddressKey(object s,KeyEventArgs e){if(e.Key==Key.Enter){var value=Address.Text.Trim();Current.View.CoreWebView2.Navigate(value.Contains(' ')?$"http://127.0.0.1:4313/?q={Uri.EscapeDataString(value)}":value.Contains("://")?value:$"https://{value}");}}
 async void ClearData(object s,RoutedEventArgs e){if(MessageBox.Show("Clear cookies, cache, normal recovery and site permissions? Downloaded files remain.","Clear local data",MessageBoxButton.YesNo)!=MessageBoxResult.Yes)return;foreach(var item in all)await item.View.CoreWebView2.Profile.ClearBrowsingDataAsync();if(File.Exists(state))File.Delete(state);Security.Text="Local browser state cleared. Downloaded files remain.";}
 void OnKeyDown(object s,KeyEventArgs e){if(Keyboard.Modifiers==ModifierKeys.Control&&e.Key==Key.L){Address.Focus();Address.SelectAll();e.Handled=true;}else if(Keyboard.Modifiers==ModifierKeys.Control&&e.Key==Key.T){NewTab(s,new());e.Handled=true;}else if(Keyboard.Modifiers.HasFlag(ModifierKeys.Control|ModifierKeys.Shift)&&e.Key==Key.N){NewPrivate(s,new());e.Handled=true;}}
 void OnClosing(object? s,System.ComponentModel.CancelEventArgs e){Save();foreach(var item in all.Where(x=>x.State.Private)){try{Directory.Delete(item.View.CoreWebView2.Environment.UserDataFolder,true);}catch{}}}
}
