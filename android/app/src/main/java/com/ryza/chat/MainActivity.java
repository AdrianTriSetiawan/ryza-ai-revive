package com.ryza.chat;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Thin WebView shell. No androidx — the whole app is the bundled web build
 * served from AssetServer on 127.0.0.1 (Spine cannot load from file://).
 */
public class MainActivity extends Activity {
    private AssetServer server;
    private WebView web;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        server = new AssetServer(getAssets(), 8765);
        server.start();

        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient());
        web.loadUrl("http://127.0.0.1:8765/");
    }

    @Override public void onPause()  { super.onPause();  if (web != null) web.onPause(); }
    @Override public void onResume() { super.onResume(); if (web != null) web.onResume(); }

    @Override
    public void onBackPressed() {
        if (web != null) {
            if (web.canGoBack()) { web.goBack(); return; }
            /* Every menu in this app is a DOM overlay on one page — side menu,
               sheets, modals, full-screen views — none of them push a URL, so
               canGoBack() is always false and the back key used to exit the app
               instead of closing the open menu. Ask the page first: if a layer
               consumed the press it returns true and we stay; only then exit.
               Must run on the UI thread, which post() guarantees. */
            web.post(() -> web.evaluateJavascript(
                "(window.RyzaShell && RyzaShell.handleBack) ? RyzaShell.handleBack() : false",
                value -> {
                    boolean handled = value != null
                            && !value.equals("false") && !value.equals("null");
                    if (!handled) MainActivity.super.onBackPressed();
                }));
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (server != null) server.stopServer();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
