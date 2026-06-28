package com.northcode.stockshop;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.IOException;
import java.io.InputStream;

public class MainActivity extends BridgeActivity {

    // True dès qu'une page stockshop.tech a chargé avec succès.
    // Avant : le SW n'est pas encore actif → shouldInterceptRequest gère tout.
    // Après : le SW est actif → on lui laisse servir les navigations offline.
    private boolean appHasLoaded = false;

    // Vrai pendant qu'on tente de rediriger vers la page /offline React.
    // Évite une boucle infinie si cette page aussi échoue.
    private boolean handlingOfflineError = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getBridge().getWebView().setWebViewClient(
            new BridgeWebViewClient(getBridge()) {

                /**
                 * Cold start hors ligne uniquement (!appHasLoaded).
                 * Sert offline-native.html depuis les assets AVANT que la requête
                 * réseau parte → impossible de voir "Webpage not available".
                 *
                 * Mid-session (appHasLoaded=true) : on passe la main au SW.
                 * Le SW sert les pages depuis next-pages ou retourne /offline.
                 * Si le SW échoue → onReceivedError gère.
                 */
                @Override
                public WebResourceResponse shouldInterceptRequest(
                        WebView view, WebResourceRequest request) {

                    if (!appHasLoaded
                            && request.isForMainFrame()
                            && "stockshop.tech".equals(request.getUrl().getHost())
                            && !isNetworkAvailable()) {
                        try {
                            InputStream stream = getAssets().open("offline-native.html");
                            return new WebResourceResponse("text/html", "UTF-8", stream);
                        } catch (IOException ignored) {}
                    }
                    return super.shouldInterceptRequest(view, request);
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    handlingOfflineError = false;
                    if (url != null && url.contains("stockshop.tech")) {
                        appHasLoaded = true;
                    }
                }

                /**
                 * Stratégie à 3 niveaux pour les erreurs offline main-frame :
                 *
                 * 1. Cold start (!appHasLoaded) : recharge l'URL →
                 *    shouldInterceptRequest la sert avec offline-native.html.
                 *
                 * 2. Mid-session, première erreur : redirige vers /fr/offline
                 *    (page React servie par le SW depuis son cache).
                 *    Pas d'appel à super → évite la page native "not available".
                 *
                 * 3. Mid-session, /offline aussi en échec : charge
                 *    offline-native.html depuis file:// en dernier recours.
                 */
                @Override
                public void onReceivedError(WebView view,
                                            WebResourceRequest request,
                                            WebResourceError error) {

                    if (!request.isForMainFrame()) {
                        super.onReceivedError(view, request, error);
                        return;
                    }

                    String host = request.getUrl().getHost();
                    if (host == null || !host.equals("stockshop.tech") || isNetworkAvailable()) {
                        super.onReceivedError(view, request, error);
                        return;
                    }

                    if (!appHasLoaded) {
                        // Cold start : recharger pour que shouldInterceptRequest intercepte
                        final String url = request.getUrl().toString();
                        view.post(() -> view.loadUrl(url));
                        return;
                    }

                    if (handlingOfflineError) {
                        // /offline React a aussi échoué → dernier recours
                        handlingOfflineError = false;
                        view.post(() -> view.loadUrl("file:///android_asset/offline-native.html"));
                        return;
                    }

                    // Mid-session : rediriger vers la page /offline React
                    // (le SW la sert depuis next-pages ou le precache)
                    handlingOfflineError = true;
                    final String locale = extractLocale(request.getUrl().getPath());
                    view.post(() -> view.loadUrl(
                        "https://stockshop.tech/" + locale + "/offline"));
                }
            }
        );
    }

    private String extractLocale(String path) {
        if (path == null || path.length() < 2) return "fr";
        String[] parts = path.split("/");
        return parts.length > 1 && !parts[1].isEmpty() ? parts[1] : "fr";
    }

    private boolean isNetworkAvailable() {
        ConnectivityManager cm =
            (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Network net = cm.getActiveNetwork();
            if (net == null) return false;
            NetworkCapabilities cap = cm.getNetworkCapabilities(net);
            return cap != null
                && cap.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } else {
            NetworkInfo info = cm.getActiveNetworkInfo();
            return info != null && info.isConnected();
        }
    }
}
