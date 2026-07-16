import SwiftUI
import WebKit
import UniformTypeIdentifiers
import UIKit
import ObjectiveC

struct BrowserWebView:UIViewRepresentable{
    @EnvironmentObject var model:BrowserModel;let tab:BrowserTab
    func makeCoordinator()->Coordinator{Coordinator(tab:tab,model:model)}
    func makeUIView(context:Context)->WKWebView{let config=WKWebViewConfiguration();config.websiteDataStore=tab.isPrivate ? .nonPersistent():.default();config.defaultWebpagePreferences.allowsContentJavaScript=true;let web=WKWebView(frame:.zero,configuration:config);web.navigationDelegate=context.coordinator;web.uiDelegate=context.coordinator;web.allowsBackForwardNavigationGestures=true;context.coordinator.bind(web);if let url=URL(string:tab.url){web.load(URLRequest(url:url))};return web}
    func updateUIView(_ web:WKWebView,context:Context){}
    final class Coordinator:NSObject,WKNavigationDelegate,WKUIDelegate,WKDownloadDelegate{
        let tab:BrowserTab;weak var model:BrowserModel?;weak var web:WKWebView?;var observers:[NSObjectProtocol]=[]
        init(tab:BrowserTab,model:BrowserModel){self.tab=tab;self.model=model}
        func bind(_ web:WKWebView){self.web=web;let center=NotificationCenter.default;for(name,action)in[(Notification.Name.ynxBack,{web.goBack()}),(.ynxForward,{web.goForward()}),(.ynxReload,{web.reload()})]{observers.append(center.addObserver(forName:name,object:tab.id,queue:.main){_ in action()})};observers.append(center.addObserver(forName:.ynxNavigate,object:tab.id,queue:.main){note in if let value=note.userInfo?["value"]as?String,let url=URL(string:value){web.load(URLRequest(url:url))}});observers.append(center.addObserver(forName:.ynxAi,object:tab.id,queue:.main){[weak self]_ in web.evaluateJavaScript("(document.body && document.body.innerText || '').slice(0,50000)"){value,_ in Task{@MainActor in self?.model?.prepareAi(characters:(value as?String)?.count ?? 0)}}})}
        deinit{for observer in observers{NotificationCenter.default.removeObserver(observer)}}
        func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!){Task{@MainActor in model?.navigated(tab.id,url:webView.url?.absoluteString ?? tab.url,title:webView.title ?? webView.url?.host ?? "Untitled")}}
        func webViewWebContentProcessDidTerminate(_ webView:WKWebView){Task{@MainActor in model?.processCrashed(tab.id)};webView.reload()}
        func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){guard let url=navigationAction.request.url else{decisionHandler(.cancel);return};if url.scheme=="ynxwallet"{UIApplication.shared.open(url);decisionHandler(.cancel);return};decisionHandler(.allow)}
        func webView(_ webView:WKWebView,decidePolicyFor navigationResponse:WKNavigationResponse,decisionHandler:@escaping(WKNavigationResponsePolicy)->Void){decisionHandler(navigationResponse.canShowMIMEType ? .allow:.download)}
        func webView(_ webView:WKWebView,navigationAction:WKNavigationAction,didBecome download:WKDownload){download.delegate=self}
        func webView(_ webView:WKWebView,navigationResponse:WKNavigationResponse,didBecome download:WKDownload){download.delegate=self}
        func download(_ download:WKDownload,decideDestinationUsing response:URLResponse,suggestedFilename:String,completionHandler:@escaping(URL?)->Void){let target=FileManager.default.urls(for:.downloadsDirectory,in:.userDomainMask)[0].appendingPathComponent(suggestedFilename);try?FileManager.default.removeItem(at:target);Task{@MainActor in model?.downloaded(title:suggestedFilename,url:response.url?.absoluteString ?? "",privateMode:tab.isPrivate)};completionHandler(target)}
        @available(iOS 15.0,*) func webView(_ webView:WKWebView,requestMediaCapturePermissionFor origin:WKSecurityOrigin,initiatedByFrame frame:WKFrameInfo,type:WKMediaCaptureType,decisionHandler:@escaping @MainActor @Sendable(WKPermissionDecision)->Void){let alert=UIAlertController(title:L.text(model?.locale ?? "en","permission"),message:"\(origin.protocol)://\(origin.host) requests \(type).",preferredStyle:.alert);alert.addAction(UIAlertAction(title:"Deny",style:.cancel){_ in decisionHandler(.deny)});alert.addAction(UIAlertAction(title:"Allow once",style:.default){_ in decisionHandler(.grant)});UIApplication.shared.connectedScenes.compactMap{$0 as?UIWindowScene}.first?.keyWindow?.rootViewController?.present(alert,animated:true)}
        func webView(_ webView:WKWebView,runOpenPanelWith parameters:WKOpenPanelParameters,initiatedByFrame frame:WKFrameInfo,completionHandler:@escaping([URL]?)->Void){let picker=UIDocumentPickerViewController(forOpeningContentTypes:[.item],asCopy:true);let delegate=PickerDelegate(completion:completionHandler);picker.delegate=delegate;objc_setAssociatedObject(picker,"ynx-picker",delegate,.OBJC_ASSOCIATION_RETAIN_NONATOMIC);UIApplication.shared.connectedScenes.compactMap{$0 as?UIWindowScene}.first?.keyWindow?.rootViewController?.present(picker,animated:true)}
    }
}
final class PickerDelegate:NSObject,UIDocumentPickerDelegate{let completion:([URL]?)->Void;init(completion:@escaping([URL]?)->Void){self.completion=completion};func documentPicker(_ controller:UIDocumentPickerViewController,didPickDocumentsAt urls:[URL]){completion(urls)};func documentPickerWasCancelled(_ controller:UIDocumentPickerViewController){completion(nil)}}
