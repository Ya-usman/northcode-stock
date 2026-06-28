package com.northcode.stockshop;

import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    private static final String OFFLINE_FALLBACK_URL =
        "https://stockshop.tech/__offline_fallback__";

    private boolean retryScheduled = false;
    // True dès que l'app a réussi à charger une page stockshop.tech.
    // Quand true, le SW est actif et gère les erreurs de navigation —
    // on ne montre plus offline-native.html pour les erreurs mid-session.
    private boolean appHasLoaded = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getBridge().getWebView().setWebViewClient(
            new BridgeWebViewClient(getBridge()) {

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    if (url != null && url.contains("stockshop.tech")
                            && !url.contains("__offline_fallback__")) {
                        appHasLoaded = true;
                    }
                }

                @Override
                public void onReceivedError(WebView view,
                                            WebResourceRequest request,
                                            WebResourceError error) {
                    super.onReceivedError(view, request, error);
                    if (!request.isForMainFrame()) return;

                    String url = request.getUrl().toString();

                    // Fallback ultime pour /__offline_fallback__ échoué
                    if (url.contains("__offline_fallback__")) {
                        retryScheduled = false;
                        if (!appHasLoaded) {
                            view.loadUrl("file:///android_asset/offline-native.html");
                        }
                        return;
                    }

                    // Mid-session : le SW est actif et sert le fallback /offline.
                    // On laisse le SW et React gérer l'erreur — pas d'interférence.
                    if (appHasLoaded) return;

                    // Cold start sans connexion : le SW n'est pas encore actif.
                    // On attend 800ms puis on tente /__offline_fallback__.
                    if (!retryScheduled) {
                        retryScheduled = true;
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
