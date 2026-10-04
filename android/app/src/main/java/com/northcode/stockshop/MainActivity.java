package com.northcode.stockshop;

import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.Logger;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    // URL dans le scope stockshop.tech servie par le SW via worker/index.js.
    // MainActivity la charge après un délai pour laisser le SW s'activer.
    // Le SW répond avec la page /offline depuis son precache → page contrôlée
    // par le SW → les clics suivants sont interceptés normalement.
    private static final String OFFLINE_FALLBACK_URL =
        "https://stockshop.tech/__offline_fallback__";

    // Délais croissants entre chaque tentative de /__offline_fallback__ — sur
    // un appareil lent, le SW peut mettre plus de 800ms à s'activer ; un seul
    // essai fixe abandonnait alors prématurément vers la page native bundlée.
    private static final long[] RETRY_DELAYS_MS = {300, 800, 2000};

    // Origine de l'app : seules ces URL sont restaurées après recréation.
    private static final String APP_ORIGIN = "https://stockshop.tech/";
    private static final String STATE_LAST_URL = "stockshop_last_url";

    private int retryAttempt = 0;
    private boolean retryScheduled = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Plugin maison (impression Bluetooth SPP) : à enregistrer AVANT super.onCreate
        registerPlugin(BluetoothPrinterPlugin.class);
        super.onCreate(savedInstanceState);

        // Activité recréée par le système (mémoire reprise pendant que l'app
        // caméra était au premier plan, retour après une longue absence…) :
        // revenir sur la page où l'on était au lieu de repartir du tableau de
        // bord. Capacitor ne conserve pas l'état du WebView ; on garde l'URL.
        if (savedInstanceState != null) {
            String lastUrl = savedInstanceState.getString(STATE_LAST_URL);
            if (lastUrl != null && lastUrl.startsWith(APP_ORIGIN) && !lastUrl.contains("__offline_fallback__")) {
                getBridge().getWebView().loadUrl(lastUrl);
            }
        }

        // Moteur de rendu du WebView tué (mémoire, photo trop lourde…) : sans
        // réponse ici, Android ferme l'application. On recrée l'activité, qui
        // recharge la dernière URL grâce à onSaveInstanceState.
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Logger.error("WebView renderer gone (crash=" + detail.didCrash() + "), recreating activity");
                view.post(MainActivity.this::recreate);
                return true;
            }
        });

        getBridge().getWebView().setWebViewClient(
            new BridgeWebViewClient(getBridge()) {
                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    // Un chargement réussi (app, fallback ou page native) repart à zéro.
                    retryAttempt = 0;
                    retryScheduled = false;
                }

                @Override
                public void onReceivedError(WebView view,
                                            WebResourceRequest request,
                                            WebResourceError error) {
                    super.onReceivedError(view, request, error);
                    if (!request.isForMainFrame()) return;

                    String url = request.getUrl().toString();
                    boolean isFallbackUrl = url.contains("__offline_fallback__");

                    // Toutes les tentatives épuisées : le SW n'est toujours pas prêt
                    // → dernier recours, page native bundlée dans l'APK.
                    if (isFallbackUrl && retryAttempt >= RETRY_DELAYS_MS.length) {
                        retryScheduled = false;
                        retryAttempt = 0;
                        view.loadUrl("file:///android_asset/offline-native.html");
                        return;
                    }

                    if (!retryScheduled) {
                        retryScheduled = true;
                        long delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
                        retryAttempt++;
                        view.postDelayed(() -> {
                            retryScheduled = false;
                            view.loadUrl(OFFLINE_FALLBACK_URL);
                        }, delay);
                    }
                }
            }
        );
    }

    @Override
    public void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        String url = webView != null ? webView.getUrl() : null;
        if (url != null) outState.putString(STATE_LAST_URL, url);
    }
}
