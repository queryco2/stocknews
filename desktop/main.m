#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
@interface Desktop : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate>
@property NSWindow *window;
@property WKWebView *web;
@property NSTask *backend;
@property NSURL *baseURL;
@property NSMutableData *output;
@property BOOL ready;
@end
@implementation Desktop
- (void)applicationDidFinishLaunching:(NSNotification *)n {
 NSMenu *menu = [NSMenu new]; NSMenuItem *item = [NSMenuItem new]; [menu addItem:item];
 NSMenu *appMenu = [NSMenu new]; item.submenu = appMenu;
 [appMenu addItemWithTitle:@"退出 Stocknews" action:@selector(terminate:) keyEquivalent:@"q"];
 NSMenuItem *editItem = [NSMenuItem new]; [menu addItem:editItem]; NSMenu *edit = [[NSMenu alloc] initWithTitle:@"编辑"]; editItem.submenu=edit;
 NSArray *titles=@[@"撤销",@"剪切",@"复制",@"粘贴",@"全选"]; NSArray *actions=@[@"undo:",@"cut:",@"copy:",@"paste:",@"selectAll:"]; NSArray *keys=@[@"z",@"x",@"c",@"v",@"a"];
 for(NSUInteger i=0;i<titles.count;i++) [edit addItemWithTitle:titles[i] action:NSSelectorFromString(actions[i]) keyEquivalent:keys[i]];
 NSApp.mainMenu=menu;
 self.window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,1280,820) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
 self.window.title=@"Stocknews"; self.window.minSize=NSMakeSize(800,600);
 self.web=[WKWebView new]; self.web.navigationDelegate=self; self.web.UIDelegate=self; self.window.contentView=self.web;
 [self.window center]; [self.window makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES];
 [self.web loadHTMLString:@"<body style='font:18px -apple-system;padding:48px'>正在启动…</body>" baseURL:nil];
 [self startBackend];
}
- (void)fail:(NSString *)message { NSAlert *a=[NSAlert new]; a.messageText=@"Stocknews"; a.informativeText=message; [a runModal]; }
- (void)startBackend {
 NSString *resources=NSBundle.mainBundle.resourcePath;
 NSString *root=[resources stringByAppendingPathComponent:@"workspace"];
 NSString *data=[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/Stocknews"];
 NSError *error=nil; [NSFileManager.defaultManager createDirectoryAtPath:data withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:&error];
 if(error){[self fail:error.localizedDescription];return;}
 self.backend=[NSTask new]; self.backend.executableURL=[NSURL fileURLWithPath:[resources stringByAppendingPathComponent:@"runtime/node"]];
 self.backend.arguments=@[[root stringByAppendingPathComponent:@"app/server/index.ts"]]; self.backend.currentDirectoryURL=[NSURL fileURLWithPath:root];
 NSMutableDictionary *env=[NSProcessInfo.processInfo.environment mutableCopy]; env[@"STOCKNEWS_DATA_DIR"]=data; env[@"PORT"]=@"0"; env[@"STOCKNEWS_DESKTOP"]=@"1";
 env[@"PATH"]=[@"/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:" stringByAppendingString:env[@"PATH"]?:@""]; self.backend.environment=env;
 NSPipe *pipe=[NSPipe pipe]; self.backend.standardOutput=pipe; self.output=[NSMutableData data];
 NSString *log=[data stringByAppendingPathComponent:@"desktop.log"];
 if(![NSFileManager.defaultManager fileExistsAtPath:log]) [NSFileManager.defaultManager createFileAtPath:log contents:nil attributes:@{NSFilePosixPermissions:@0600}];
 NSFileHandle *handle=[NSFileHandle fileHandleForWritingAtPath:log]; [handle seekToEndOfFile]; self.backend.standardError=handle;
 __weak Desktop *weakSelf=self;
 pipe.fileHandleForReading.readabilityHandler=^(NSFileHandle *stream){NSData *bytes=stream.availableData;if(!bytes.length)return;dispatch_async(dispatch_get_main_queue(),^{
 Desktop *s=weakSelf;if(!s||s.ready)return;[s.output appendData:bytes];NSString *text=[[NSString alloc] initWithData:s.output encoding:NSUTF8StringEncoding];
 NSArray *lines=[text componentsSeparatedByString:@"\n"];
 for(NSUInteger i=0;i+1<lines.count;i++){NSString *line=lines[i];NSString *prefix=@"Stocknews API ";if([line hasPrefix:[prefix stringByAppendingString:@"http://127.0.0.1:"]]){s.baseURL=[NSURL URLWithString:[line substringFromIndex:prefix.length]];s.ready=YES;[s.web loadRequest:[NSURLRequest requestWithURL:s.baseURL]];}}
 });};
 self.backend.terminationHandler=^(NSTask *task){dispatch_async(dispatch_get_main_queue(),^{[weakSelf fail:@"本地服务已退出。日志位于 ~/Library/Application Support/Stocknews/desktop.log，请重新打开应用。"];});};
 if(![self.backend launchAndReturnError:&error]){self.backend.terminationHandler=nil;[self fail:error.localizedDescription];return;}
 dispatch_after(dispatch_time(DISPATCH_TIME_NOW,30*NSEC_PER_SEC),dispatch_get_main_queue(),^{if(!weakSelf.ready)[weakSelf fail:@"启动超时，请检查 desktop.log。"];});
}
- (void)webView:(WKWebView *)web decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
 NSURL *u=action.request.URL;
 if([u.scheme isEqual:@"about"]||([u.scheme isEqual:self.baseURL.scheme]&&[u.host isEqual:self.baseURL.host]&&[u.port isEqual:self.baseURL.port])){handler(WKNavigationActionPolicyAllow);return;}
 if([@[@"https",@"http",@"workbuddy",@"obsidian"] containsObject:u.scheme]) [NSWorkspace.sharedWorkspace openURL:u]; handler(WKNavigationActionPolicyCancel);
}
- (WKWebView *)webView:(WKWebView *)web createWebViewWithConfiguration:(WKWebViewConfiguration *)config forNavigationAction:(WKNavigationAction *)action windowFeatures:(WKWindowFeatures *)features {
 if([@[@"https",@"http"] containsObject:action.request.URL.scheme]) [NSWorkspace.sharedWorkspace openURL:action.request.URL];return nil;
}
- (void)webView:(WKWebView *)web runJavaScriptConfirmPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL))handler {
 NSAlert *a=[NSAlert new];a.messageText=message;[a addButtonWithTitle:@"确定"];[a addButtonWithTitle:@"取消"];handler([a runModal]==NSAlertFirstButtonReturn);
}
- (void)webView:(WKWebView *)web runJavaScriptAlertPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))handler { [self fail:message];handler(); }
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {return YES;}
- (void)applicationWillTerminate:(NSNotification *)n {self.backend.terminationHandler=nil;[self.backend terminate];}
@end
int main(int argc,const char *argv[]){@autoreleasepool {NSApplication *app=NSApplication.sharedApplication;Desktop *delegate=[Desktop new];app.delegate=delegate;[app setActivationPolicy:NSApplicationActivationPolicyRegular];[app run];}return 0;}
