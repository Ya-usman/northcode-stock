package com.northcode.stockshop;

import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
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
                @Override
                public void onReceivedError(WebView view,
                                            WebResourceRequest request,
                                            WebResourceError error) {
                    super.onReceivedError(view, request, error);
                    if (!request.isForMainFrame()) return;

                    try {
                        InputStream is = getAssets().open("offline-native.html");
                        byte[] buffer = new byte[is.available()];
                        is.read(buffer);
                        is.close();
                        String html = new String(buffer, "UTF-8");

                        // Charger l'HTML avec https://stockshop.tech/ comme URL de base.
                        // Ceci maintient le Service Worker dans son scope — les navigations
                        // suivantes (clic sur une carte) sont interceptées par le SW et
                        // servies depuis le cache, contrairement à file:// qui est hors scope.
                        view.loadDataWithBaseURL(
                            "https://stockshop.tech/",
                            html,
                            "text/html",
                            "UTF-8",
                            null
                        );
                    } catch (IOException e) {
                        // Fallback au cas où la lecture du fichier échoue
                        view.loadUrl("file:///android_asset/offline-native.html");
                    }
                }
            }
        );
    }
}
