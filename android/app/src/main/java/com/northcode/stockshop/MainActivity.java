package com.northcode.stockshop;

import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Android WebView ne réveille pas le Service Worker avant la navigation
        // initiale — quand offline, WebView affiche son écran d'erreur natif
        // avant que le SW puisse intercepter. On wrape le client Capacitor pour
        // capturer les erreurs réseau et charger une page offline locale à la place.
        getBridge().getWebView().setWebViewClient(
            new BridgeWebViewClient(getBridge()) {
                @Override
                public void onReceivedError(WebView view,
                                            WebResourceRequest request,
                                            WebResourceError error) {
                    super.onReceivedError(view, request, error);
                    if (request.isForMainFrame()) {
                        view.loadUrl("file:///android_asset/offline-native.html");
                    }
                }
            }
        );
    }
}
