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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getBridge().getWebView().setWebViewClient(
            new BridgeWebViewClient(getBridge()) {

                /**
                 * Intercepte TOUTE navigation main-frame vers stockshop.tech hors ligne.
                 * Sert offline-native.html directement depuis les assets — aucune requête
                 * réseau ne part, donc "Webpage not available" est impossible.
                 * Couvre cold start ET navigations mid-session (ex. Dashboard → Stock).
                 */
                @Override
                public WebResourceResponse shouldInterceptRequest(
                        WebView view, WebResourceRequest request) {

                    if (request.isForMainFrame()
                            && "stockshop.tech".equals(request.getUrl().getHost())
                            && !isNetworkAvailable()) {
                        try {
                            InputStream stream = getAssets().open("offline-native.html");
                            return new WebResourceResponse("text/html", "UTF-8", stream);
                        } catch (IOException ignored) {}
                    }
                    return super.shouldInterceptRequest(view, request);
                }

                /**
                 * Race condition : la connexion peut tomber entre shouldInterceptRequest
                 * et l'envoi réel de la requête réseau. Si onReceivedError s'affiche
                 * quand même, on recharge l'URL — shouldInterceptRequest l'interceptera.
                 */
                @Override
                public void onReceivedError(WebView view,
                                            WebResourceRequest request,
                                            WebResourceError error) {
                    super.onReceivedError(view, request, error);
                    if (!request.isForMainFrame()) return;
                    String host = request.getUrl().getHost();
                    if (host != null
                            && host.equals("stockshop.tech")
                            && !isNetworkAvailable()) {
                        final String url = request.getUrl().toString();
                        view.post(() -> view.loadUrl(url));
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
