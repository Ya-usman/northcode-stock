package com.northcode.stockshop;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.IOException;
import java.io.InputStream;

public class MainActivity extends BridgeActivity {

    // True dès qu'une page stockshop.tech a été chargée avec succès.
    // Une fois true, le SW est actif — on le laisse gérer l'offline.
    private boolean appHasLoaded = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getBridge().getWebView().setWebViewClient(
            new BridgeWebViewClient(getBridge()) {

                @Override
                public WebResourceResponse shouldInterceptRequest(
                        WebView view, WebResourceRequest request) {

                    // Cold start hors ligne : servir offline-native.html
                    // directement depuis les assets AVANT que la requête réseau
                    // parte. Évite totalement la page native "Webpage not available".
                    // Condition stricte : main frame + hôte stockshop.tech +
                    // hors ligne + app pas encore chargée (SW pas actif).
                    if (!appHasLoaded
                            && request.isForMainFrame()
                            && "stockshop.tech".equals(request.getUrl().getHost())
                            && !isNetworkAvailable()) {
                        try {
                            InputStream stream = getAssets().open("offline-native.html");
                            return new WebResourceResponse(
                                "text/html", "UTF-8", stream);
                        } catch (IOException e) {
                            // Laisse passer — onReceivedError prendra le relais
                        }
                    }
                    return super.shouldInterceptRequest(view, request);
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    // Marquer l'app comme chargée dès la 1ère page stockshop.tech.
                    // À partir de là le SW est actif et gère tout lui-même.
                    if (url != null
                            && url.contains("stockshop.tech")
                            && !url.contains("__offline_fallback__")) {
                        appHasLoaded = true;
                    }
                }
            }
        );
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
