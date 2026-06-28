package com.northcode.stockshop;

import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    // URL dans le scope stockshop.tech servie par le SW via worker/index.js.
    // MainActivity la charge après un délai pour laisser le SW s'activer.
    // Le SW répond avec la page /offline depuis son precache → page contrôlée
    // par le SW → les clics suivants sont interceptés normalement.
    private static final String OFFLINE_FALLBACK_URL =
        "https://stockshop.tech/__offline_fallback__";

    private boolean retryScheduled = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getBridge().getWebView().setWebViewClient(
            new BridgeWebViewClient(getBridge()) {
                @Override
                public void onReceivedError(WebView view,
                                            WebResourceRequest request,
                                            WebResourceError error) {
                    super.onReceivedError(view, request, error);
                    if (!request.isForMainFrame()) return;

                    String url = request.getUrl().toString();

                    // Le SW n'a pas pu servir /__offline_fallback__ non plus
                    // (SW jamais activé = app jamais utilisée en ligne)
                    // → dernier recours : page native bundlée dans l'APK
                    if (url.contains("__offline_fallback__")) {
                        retryScheduled = false;
                        view.loadUrl("file:///android_asset/offline-native.html");
                        return;
                    }

                    if (!retryScheduled) {
                        retryScheduled = true;
                        // Attendre 800ms que le SW s'active, puis charger
                        // /__offline_fallback__ que le SW sert depuis le cache.
                        view.postDelayed(() -> {
                            retryScheduled = false;
                            view.loadUrl(OFFLINE_FALLBACK_URL);
                        }, 800);
                    }
                }
            }
        );
    }
}
