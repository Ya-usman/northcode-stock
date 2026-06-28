package com.northcode.stockshop;

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

    // URL fictive dans le scope stockshop.tech — shouldInterceptRequest
    // la sert depuis les assets AVANT que le SW ou le réseau ne soient consultés.
    // Cela garantit que la page offline est chargée dans le scope https://
    // du SW, et que les navigations suivantes (clic sur une carte) sont
    // interceptées par le SW et servies depuis le cache.
    private static final String OFFLINE_URL =
        "https://stockshop.tech/__offline_fallback__";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getBridge().getWebView().setWebViewClient(
            new BridgeWebViewClient(getBridge()) {

                @Override
                public WebResourceResponse shouldInterceptRequest(
                        WebView view, WebResourceRequest request) {

                    if (OFFLINE_URL.equals(request.getUrl().toString())) {
                        try {
                            InputStream is = getAssets().open("offline-native.html");
                            return new WebResourceResponse(
                                "text/html", "UTF-8", is);
                        } catch (IOException e) {
                            return null;
                        }
                    }
                    return super.shouldInterceptRequest(view, request);
                }

                @Override
                public void onReceivedError(WebView view,
                                            WebResourceRequest request,
                                            WebResourceError error) {
                    super.onReceivedError(view, request, error);
                    if (!request.isForMainFrame()) return;
                    // Éviter une boucle infinie si l'URL offline elle-même échoue
                    if (OFFLINE_URL.equals(request.getUrl().toString())) return;
                    view.loadUrl(OFFLINE_URL);
                }
            }
        );
    }
}
