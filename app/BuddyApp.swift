// Buddy.app: your private voice AI and its characters, in the menu bar.
// The menu bar icon opens a small chat window: the page served by buddy_server.py at http://127.0.0.1:12400/?mac=1.
// Closing the window only hides it, so characters can still text you first (spoken aloud) and the icon fills when
// something new arrives. Menu: Open Buddy, Talk to Buddy, Open Saved Chats, Check for Updates, Open at Login, Quit.
// Settings → Backup asks this app for the usual macOS pickers (where backups go, a backup to restore) and Show in Finder.
import Cocoa
import CoreImage
import CryptoKit
import ServiceManagement
import UniformTypeIdentifiers
import WebKit

final class App: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var statusItem: NSStatusItem!
    var server: Process?
    var unread = 0
    var talkRequested: Date?          // "Talk" was chosen before the page was ready
    var placeholderShown = false
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    var dir: String { home + "/BuddyFace" }
    var updating = false
    var verified = false              // the server proved it's this Buddy (not something else on the port)
    var connecting = false
    var authAsks: [Date] = []         // the page asking for the key again (a loop would mean something's wrong)
    let url = URL(string: "http://127.0.0.1:12400/?mac=1")!

    func applicationDidFinishLaunching(_ n: Notification) {
        startServerIfNeeded()
        setUpMainMenu()
        setUpWindow()
        setUpStatusItem()
        // Updates: shortly after launch (so a login start checks too), then every few hours.
        Timer.scheduledTimer(withTimeInterval: 600, repeats: true) { [weak self] _ in self?.autoUpdate() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 90) { [weak self] in self?.autoUpdate() }
        // The very first time, open the window so you can see where Buddy lives; after that it waits in the menu bar.
        if !UserDefaults.standard.bool(forKey: "welcomed") {
            UserDefaults.standard.set(true, forKey: "welcomed")
            showBuddy()
        } else if UserDefaults.standard.bool(forKey: "showAfterUpdate") {   // relaunched by an update: back where you were
            UserDefaults.standard.removeObject(forKey: "showAfterUpdate")
            showBuddy()
        }
        // An update that restarted Buddy leaves its result here (the old Buddy that asked for it was closed). It's
        // written once the new version is up, which can take a while: look a few times (it's shown only once).
        for t in [3.0, 8, 20, 45, 90, 180] {
            DispatchQueue.main.asyncAfter(deadline: .now() + t) { [weak self] in self?.showUpdateResult(nil) }
        }
        // An update that got cut off (shutdown, crash) is finished right away, not hours later: until then the new
        // code runs without having been checked.
        // (Not when an update is what just relaunched us: it's still running and finishes by itself.)
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
            guard let self = self, FileManager.default.fileExists(atPath: self.dir + "/.update_from"),
                  !self.updateRunning() else { return }
            self.runUpdate(manual: false)
        }
    }

    // ---------- the chat window ----------
    func setUpWindow() {
        let cfg = WKWebViewConfiguration()
        cfg.mediaTypesRequiringUserActionForPlayback = []      // so a message that arrives while hidden can be spoken
        #if compiler(>=5.9)
        if #available(macOS 14.0, *) {
            cfg.preferences.inactiveSchedulingPolicy = .none   // keep the page (and its voice) running while hidden
        }
        #endif
        cfg.userContentController.add(self, name: "buddy")
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 420, height: 680), configuration: cfg)
        web.setValue(false, forKey: "drawsBackground")
        web.uiDelegate = self
        web.navigationDelegate = self
        web.autoresizingMask = [.width, .height]

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 680),
                          styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "Buddy"
        window.contentMinSize = NSSize(width: 340, height: 480)
        window.isReleasedWhenClosed = false
        window.collectionBehavior = [.moveToActiveSpace]
        window.tabbingMode = .disallowed
        window.delegate = self
        window.contentView = web
        window.center()                                        // first time; afterwards wherever you left it
        _ = window.setFrameUsingName("BuddyChat")
        _ = window.setFrameAutosaveName("BuddyChat")
        connect()
    }

    // ---------- the lock: this window gets the Mac's key, after the server proves it's really this Buddy ----------
    // The server keeps the key in ~/BuddyFace/.mac_token (only you can read it). Anything else that might be answering
    // on Buddy's port (another account's Buddy, another program) can't prove it knows the key, so the window doesn't
    // load from it and it never gets the microphone.
    func connect() {
        if connecting { return }
        connecting = true
        let tokenPath = dir + "/.mac_token"
        DispatchQueue.global().async { [weak self] in
            guard let self = self else { return }
            var token = "", outcome = "starting"
            for _ in 0..<40 {                                  // the server makes the key when it starts
                token = ((try? String(contentsOfFile: tokenPath, encoding: .utf8)) ?? "")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !token.isEmpty { outcome = self.verify(token) }
                if outcome != "starting" { break }
                Thread.sleep(forTimeInterval: 0.5)
            }
            DispatchQueue.main.async {
                self.connecting = false
                switch outcome {
                case "ok":
                    self.verified = true
                    let cookie = HTTPCookie(properties: [.domain: "127.0.0.1", .path: "/", .name: "buddy", .value: token,
                        .expires: Date().addingTimeInterval(10 * 365 * 86400), HTTPCookiePropertyKey("HttpOnly"): "TRUE"])!
                    self.web.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) {
                        self.web.load(URLRequest(url: self.url))
                    }
                case "impostor":
                    self.verified = false
                    self.web.loadHTMLString(self.note("Something else is answering on Buddy's port (12400), so Buddy " +
                        "won't talk to it. Is Buddy running in another user account on this Mac? Quit it there, then " +
                        "choose Open Buddy again."), baseURL: nil)
                default:
                    if !self.placeholderShown { self.placeholderShown = true; self.web.loadHTMLString(self.startingPage, baseURL: nil) }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.connect() }
                }
            }
        }
    }
    // "ok", "impostor" (answers but can't prove it's Buddy) or "starting" (not answering yet).
    func verify(_ token: String) -> String {
        let nonce = UUID().uuidString
        // The key itself is never sent here: whatever answers must prove it already knows it.
        var req = URLRequest(url: URL(string: "http://127.0.0.1:12400/api/hello?nonce=\(nonce)")!, timeoutInterval: 3)
        req.httpShouldHandleCookies = false
        var result = "starting"
        let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            defer { sem.signal() }
            guard let code = (resp as? HTTPURLResponse)?.statusCode else { return }
            let got = (try? JSONSerialization.jsonObject(with: data ?? Data())) as? [String: Any]
            let want = HMAC<SHA256>.authenticationCode(for: Data(nonce.utf8), using: SymmetricKey(data: Data(token.utf8)))
                .map { String(format: "%02x", $0) }.joined()
            result = code == 200 && (got?["proof"] as? String) == want ? "ok" : "impostor"
        }.resume()
        _ = sem.wait(timeout: .now() + 4)
        return result
    }
    func note(_ text: String) -> String {
        return "<!doctype html><meta charset=\"utf-8\"><meta name=\"color-scheme\" content=\"light dark\"><body style=\"margin:0;" +
            "height:100vh;display:flex;align-items:center;justify-content:center;font:15px -apple-system,sans-serif;" +
            "color:#888;text-align:center;padding:0 28px\"><div>\(text)</div></body>"
    }
    // A QR code for pairing a phone (made here on the Mac; the address is only ever shown on your screen).
    func qr(_ text: String) -> String? {
        guard let f = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        f.setValue(Data(text.utf8), forKey: "inputMessage"); f.setValue("M", forKey: "inputCorrectionLevel")
        guard let img = f.outputImage?.samplingNearest().transformed(by: CGAffineTransform(scaleX: 8, y: 8)) else { return nil }
        let rep = NSBitmapImageRep(ciImage: img)
        guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
        return "data:image/png;base64," + png.base64EncodedString()
    }

    @objc func showBuddy() {
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        _ = window.makeFirstResponder(web)
        tellShown()
    }

    // Closing only hides the window (Buddy keeps running in the menu bar) and hands focus back to your last app.
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        tellShown()
        NSApp.deactivate()
        return false
    }

    func tellShown() {
        let on = window.isVisible
        if on { setUnread(0) }
        js("window.buddyNative && window.buddyNative.shown && window.buddyNative.shown(\(on))")
    }

    @objc func talk() {
        showBuddy()
        let code = "(function () { var b = window.buddyNative; if (!b || !b.talk) return false;"
            + " try { b.talk(); } catch (e) {} return true; })()"
        web.evaluateJavaScript(code) { [weak self] result, _ in
            if (result as? Bool) != true { self?.talkRequested = Date() }   // page still loading: talk once it's ready
        }
    }

    func js(_ code: String) { web.evaluateJavaScript(code, completionHandler: nil) }

    func setUnread(_ n: Int) {
        if n == unread { return }
        unread = n
        updateIcon()
    }

    // ---------- menu bar ----------
    func setUpStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.toolTip = "Buddy"
        updateIcon()
        let m = NSMenu()
        m.addItem(withTitle: "Open Buddy", action: #selector(showBuddy), keyEquivalent: "o").target = self
        m.addItem(withTitle: "Talk to Buddy", action: #selector(talk), keyEquivalent: "t").target = self
        m.addItem(.separator())
        m.addItem(withTitle: "Open Saved Chats", action: #selector(openChats), keyEquivalent: "").target = self
        m.addItem(withTitle: "Check for Updates…", action: #selector(checkUpdates), keyEquivalent: "u").target = self
        let login = NSMenuItem(title: "Open at Login", action: #selector(toggleLogin(_:)), keyEquivalent: "")
        login.target = self; login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        m.addItem(login)
        m.addItem(.separator())
        m.addItem(withTitle: "Quit Buddy", action: #selector(quit), keyEquivalent: "q").target = self
        statusItem.menu = m
    }

    // Filled bubbles while there are messages you haven't seen yet.
    func updateIcon() {
        let name = unread > 0 ? "bubble.left.and.bubble.right.fill" : "bubble.left.and.bubble.right"
        let img = NSImage(systemSymbolName: name, accessibilityDescription: unread > 0 ? "Buddy, new messages" : "Buddy")
        img?.isTemplate = true
        statusItem.button?.image = img
        if img == nil { statusItem.button?.title = unread > 0 ? "Buddy •" : "Buddy" }
    }

    // Not visible (Buddy is a menu bar app), but it makes the usual shortcuts work in the chat window:
    // copy, paste, undo, select all, close (hides it), reload, quit.
    func setUpMainMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(), appMenu = NSMenu(title: "Buddy")
        appMenu.addItem(withTitle: "Reload Buddy", action: #selector(reload), keyEquivalent: "r").target = self
        appMenu.addItem(withTitle: "Quit Buddy", action: #selector(quit), keyEquivalent: "q").target = self
        appItem.submenu = appMenu
        main.addItem(appItem)
        let editItem = NSMenuItem(), edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: Selector(("cut:")), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: Selector(("copy:")), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: Selector(("paste:")), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: Selector(("selectAll:")), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(editItem)
        let windowItem = NSMenuItem(), windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        main.addItem(windowItem)
        NSApp.mainMenu = main
    }

    // Opening Buddy.app again (Finder, Spotlight) shows the window.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showBuddy()
        return false
    }

    func startServerIfNeeded() {
        var up = false
        let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: URL(string: "http://127.0.0.1:12400/api/status")!) { _, r, _ in
            up = (r as? HTTPURLResponse)?.statusCode == 200; sem.signal() }.resume()
        _ = sem.wait(timeout: .now() + 1.5)
        if up { return }
        let p = Process()
        let pythons = [dir + "/.venv/bin/python", "/opt/homebrew/bin/python3", "/usr/bin/python3"]
        p.executableURL = URL(fileURLWithPath: pythons.first { FileManager.default.isExecutableFile(atPath: $0) } ?? pythons[2])
        p.arguments = [dir + "/buddy_server.py"]
        p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
        try? p.run(); server = p
    }

    // Messages from the page.
    func userContentController(_ c: WKUserContentController, didReceive msg: WKScriptMessage) {
        guard let d = msg.body as? [String: Any], let type = d["type"] as? String else { return }
        switch type {
        case "ready":
            tellShown()
            if let t = talkRequested {
                talkRequested = nil
                if Date().timeIntervalSince(t) < 30 { talk() }
            }
        case "unread":
            setUnread(max(0, (d["count"] as? NSNumber)?.intValue ?? 0))
        case "auth":                                       // the page says it isn't let in: get the key again
            authAsks = authAsks.filter { $0.timeIntervalSinceNow > -60 } + [Date()]
            if authAsks.count > 3 {
                web.loadHTMLString(note("Buddy's window couldn't sign in to Buddy. Quit Buddy and open it again; if " +
                    "that doesn't help, run <code>zsh ~/BuddyFace/scripts/doctor.sh</code> in Terminal."), baseURL: nil)
            } else { verified = false; connect() }
        case "micsettings":                                // a call hears only silence: where the microphone is allowed
            if let u = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") {
                NSWorkspace.shared.open(u)
            }
        case "qr":
            if let t = d["text"] as? String, t.hasPrefix("https://"), t.count < 300, let png = qr(t) {
                js("window.buddyNative && window.buddyNative.qr && window.buddyNative.qr('\(png)')")
            }
        case "pick":                                       // Settings → Backup: a folder, or a backup file to restore
            guard let id = (d["id"] as? NSNumber)?.intValue, let purpose = d["purpose"] as? String else { return }
            pick(purpose, start: d["start"] as? String) { [weak self] path in
                var chosen: Any = NSNull()
                if let p = path { chosen = p }
                let arg = (try? JSONSerialization.data(withJSONObject: [id, chosen] as [Any]))
                    .flatMap { String(data: $0, encoding: .utf8) } ?? "[\(id),null]"
                self?.js("window.buddyNative && window.buddyNative.picked && window.buddyNative.picked.apply(null, \(arg))")
            }
        case "reveal":                                     // "Show in Finder" (your home folder or a drive only)
            if let p = d["path"] as? String, p.hasPrefix(home + "/") || p.hasPrefix("/Volumes/"),
               FileManager.default.fileExists(atPath: p) {
                NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: p)])
            }
        default: break
        }
    }

    // Until the server is up (it takes a second or two to start), show a short note and retry every second.
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) {
        let err = e as NSError
        if err.domain != NSURLErrorDomain || err.code == NSURLErrorCancelled { return }
        if !placeholderShown {
            placeholderShown = true
            w.loadHTMLString(startingPage, baseURL: nil)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.verified = false; self.connect() }
    }
    func webViewWebContentProcessDidTerminate(_ w: WKWebView) { connect() }

    let startingPage = """
        <!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark">
        <body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
        font:15px -apple-system,sans-serif;color:#888;text-align:center">
        <div>Starting Buddy…<br><br><small>If this takes more than a minute, run<br>
        <code>zsh ~/BuddyFace/scripts/doctor.sh</code> in Terminal.</small></div></body>
        """

    // Microphone for talking to Buddy (macOS also asks you once).
    func webView(_ w: WKWebView, requestMediaCapturePermissionFor o: WKSecurityOrigin, initiatedByFrame f: WKFrameInfo,
                 type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(o.host == "127.0.0.1" && o.port == 12400 && verified ? .grant : .deny)   // only the real Buddy
    }

    // Links open in your browser, so the chat window always stays on Buddy.
    func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.navigationType == .linkActivated, let u = action.request.url, u.host != "127.0.0.1" {
            openExternally(u)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for action: WKNavigationAction,
                 windowFeatures f: WKWindowFeatures) -> WKWebView? {
        if let u = action.request.url { openExternally(u) }
        return nil
    }
    // "Upload picture" (a character's profile picture): the usual file picker, pictures only.
    func webView(_ w: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true; panel.canChooseDirectories = false
        panel.allowsMultipleSelection = p.allowsMultipleSelection
        panel.allowedContentTypes = [.image]
        if let win = w.window {
            panel.beginSheetModal(for: win) { r in completionHandler(r == .OK ? panel.urls : nil) }
        } else {
            completionHandler(panel.runModal() == .OK ? panel.urls : nil)
        }
    }
    // Backups: the usual macOS picker for where backups go, or for a backup to restore. Only the chosen path goes
    // back to the page (JSON-encoded, so any name is safe); the server checks it again.
    func pick(_ purpose: String, start: String?, done: @escaping (String?) -> Void) {
        let folder = purpose == "folder", panel = NSOpenPanel()
        panel.canChooseDirectories = folder; panel.canChooseFiles = !folder
        panel.canCreateDirectories = folder; panel.allowsMultipleSelection = false
        panel.prompt = folder ? "Use This Folder" : "Choose"
        panel.message = folder ? "Choose where Buddy keeps its encrypted backups (iCloud Drive, Dropbox, Google Drive, OneDrive or a USB drive)."
                               : "Choose a Buddy backup (a file named like 2026-10-09.buddybackup)."
        if !folder { panel.allowedContentTypes = [UTType(filenameExtension: "buddybackup") ?? .data] }
        for p in [start ?? "", home + "/Library/Mobile Documents/com~apple~CloudDocs"] {
            var isDir: ObjCBool = false
            if (p.hasPrefix(home + "/") || p.hasPrefix("/Volumes/")) && FileManager.default.fileExists(atPath: p, isDirectory: &isDir) && isDir.boolValue {
                panel.directoryURL = URL(fileURLWithPath: p); break
            }
        }
        showBuddy()
        panel.beginSheetModal(for: window) { r in done(r == .OK ? panel.url?.path : nil) }
    }
    func openExternally(_ u: URL) {
        let scheme = (u.scheme ?? "").lowercased()
        if scheme == "http" || scheme == "https" || scheme == "mailto" { NSWorkspace.shared.open(u) }
    }

    @objc func openChats() {
        let p = home + "/Buddy/chats"
        try? FileManager.default.createDirectory(atPath: p, withIntermediateDirectories: true)
        NSWorkspace.shared.open(URL(fileURLWithPath: p))
    }
    @objc func reload() { verified = false; connect() }

    // ---------- updates (fast-forward from GitHub main; rolls back if the new version won't start) ----------
    func autoUpdate() {
        let last = UserDefaults.standard.double(forKey: "lastUpdateCheck"), since = Date().timeIntervalSince1970 - last
        // Only while you're away from the keyboard and mouse (5 min), so an update never interrupts you; after a day, anyway.
        let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
        guard since > 3 * 3600 && (idle > 300 || since > 24 * 3600) else { return }
        // Never in the middle of a call, while talking or typing, or while you're chatting from your phone.
        // After a day without a check, only a call or something being said holds it up (an unsent draft is kept).
        let overdue = since > 24 * 3600 ? "true" : "false"
        web.evaluateJavaScript("!!(window.buddyNative && window.buddyNative.busy && window.buddyNative.busy(\(overdue)))") { [weak self] busy, _ in
            if (busy as? Bool) != true { self?.runUpdate(manual: false) }
        }
    }
    @objc func checkUpdates() { runUpdate(manual: true) }
    func runUpdate(manual: Bool) {
        if updating { return }
        updating = true
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "lastUpdateCheck")
        UserDefaults.standard.set(manual || window.isVisible, forKey: "showAfterUpdate")   // if the update relaunches us
        UserDefaults.standard.set(manual, forKey: "manualUpdate")
        let p = Process(), out = Pipe()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = [dir + "/scripts/update.sh"]
        p.standardOutput = out; p.standardError = FileHandle.nullDevice
        p.terminationHandler = { [weak self] _ in
            let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            let line = text.components(separatedBy: "\n").last { $0.hasPrefix("STATUS: ") } ?? "STATUS: no answer"
            let status = String(line.dropFirst(8))
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.updating = false
                UserDefaults.standard.removeObject(forKey: "showAfterUpdate")
                if status.hasPrefix("updated") || status.hasPrefix("update failed") { self.reload() }
                self.showUpdateResult(status)
            }
        }
        do { try p.run() } catch { updating = false; return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 20 * 60) { [weak self] in   // never stuck "checking" for good
            if p.isRunning { p.terminate(); self?.updating = false }
        }
    }
    // An update is running right now: the pid it left in .update.lock is alive and still the updater (a note left
    // by one that was cut off doesn't count, even if that pid was given to some other program since).
    func updateRunning() -> Bool {
        guard let s = try? String(contentsOfFile: dir + "/.update.lock/pid", encoding: .utf8),
              let pid = Int32(s.trimmingCharacters(in: .whitespacesAndNewlines)), kill(pid, 0) == 0 else { return false }
        let ps = Process(), out = Pipe()
        ps.executableURL = URL(fileURLWithPath: "/bin/ps")
        ps.arguments = ["-o", "command=", "-p", String(pid)]
        ps.standardOutput = out; ps.standardError = FileHandle.nullDevice
        guard (try? ps.run()) != nil else { return true }
        let cmd = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        ps.waitUntilExit()
        return cmd.contains("update.sh")
    }
    // Tells you how an update went: always after "Check for Updates", and whenever one failed.
    func showUpdateResult(_ given: String?) {
        if given == nil && updating { return }        // this Buddy's own check is running: it tells you when it's done
        let file = dir + "/.update_result"
        let left = (try? String(contentsOfFile: file, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
        try? FileManager.default.removeItem(atPath: file)
        guard let status = given ?? left, !status.isEmpty else { return }
        let manual = UserDefaults.standard.bool(forKey: "manualUpdate")
        UserDefaults.standard.removeObject(forKey: "manualUpdate")
        let bad = status.hasPrefix("update failed") || status.hasPrefix("couldn't build")
        guard manual || bad else { return }
        let a = NSAlert(); a.messageText = "Buddy updates"
        a.informativeText = status.prefix(1).uppercased() + status.dropFirst()
        NSApp.activate(ignoringOtherApps: true); a.runModal()
    }
    // Start at login (off until you switch it on here).
    @objc func toggleLogin(_ sender: NSMenuItem) {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
            else { try SMAppService.mainApp.register() }
        } catch {}
        sender.state = SMAppService.mainApp.status == .enabled ? .on : .off
    }

    func stopServer() {
        server?.terminate()
        let k = Process(); k.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        k.arguments = ["-f", "[Pp]ython[0-9.]* " + dir + "/buddy_server.py"]   // only Buddy's server, not an editor
        if (try? k.run()) != nil { k.waitUntilExit() }
    }
    @objc func quit() { stopServer(); NSApp.terminate(nil) }
    func applicationWillTerminate(_ n: Notification) { stopServer() }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
