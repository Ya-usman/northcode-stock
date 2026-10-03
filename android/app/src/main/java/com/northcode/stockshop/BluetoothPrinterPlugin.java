package com.northcode.stockshop;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;

/**
 * Impression directe sur imprimante thermique Bluetooth CLASSIQUE (profil SPP),
 * celui des Xprinter / Goojprt / MHT bon marché. Pas de scan ni de localisation :
 * l'appairage se fait dans les réglages Bluetooth d'Android, on ne liste que
 * les appareils déjà appairés. Les octets (ESC/POS) sont produits côté web.
 *
 * Permissions : BLUETOOTH_CONNECT à l'exécution à partir d'Android 12 (API 31) ;
 * en dessous, BLUETOOTH / BLUETOOTH_ADMIN sont accordées à l'installation.
 */
@CapacitorPlugin(
    name = "BluetoothPrinter",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class BluetoothPrinterPlugin extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int CHUNK = 512;

    private boolean needsRuntimePermission() {
        return Build.VERSION.SDK_INT >= 31;
    }

    private boolean ensurePermission(PluginCall call) {
        if (!needsRuntimePermission()) return true;
        if (getPermissionState("bluetooth") == PermissionState.GRANTED) return true;
        requestPermissionForAlias("bluetooth", call, "permissionCallback");
        return false;
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        if (getPermissionState("bluetooth") != PermissionState.GRANTED) {
            call.reject("Permission Bluetooth refusée", "PERMISSION_DENIED");
            return;
        }
        if ("print".equals(call.getMethodName())) doPrint(call);
        else doListPaired(call);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        JSObject ret = new JSObject();
        ret.put("available", adapter != null);
        ret.put("enabled", adapter != null && adapter.isEnabled());
        call.resolve(ret);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void listPaired(PluginCall call) {
        if (!ensurePermission(call)) return;
        doListPaired(call);
    }

    private void doListPaired(PluginCall call) {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) { call.reject("Pas de Bluetooth sur cet appareil", "NO_BLUETOOTH"); return; }
        if (!adapter.isEnabled()) { call.reject("Bluetooth désactivé", "BLUETOOTH_OFF"); return; }
        JSArray devices = new JSArray();
        try {
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            for (BluetoothDevice d : bonded) {
                JSObject o = new JSObject();
                o.put("name", d.getName() != null ? d.getName() : d.getAddress());
                o.put("address", d.getAddress());
                BluetoothClass cls = d.getBluetoothClass();
                // IMAGING (0x600) = imprimantes/scanners : affichées en premier côté web
                o.put("majorClass", cls != null ? cls.getMajorDeviceClass() : 0);
                devices.put(o);
            }
        } catch (SecurityException e) {
            call.reject("Permission Bluetooth refusée", "PERMISSION_DENIED");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("devices", devices);
        call.resolve(ret);
    }

    @PluginMethod
    public void print(PluginCall call) {
        if (!ensurePermission(call)) return;
        doPrint(call);
    }

    private void doPrint(PluginCall call) {
        String address = call.getString("address");
        String data = call.getString("data");
        if (address == null || data == null) { call.reject("address et data requis", "BAD_ARGS"); return; }
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) { call.reject("Pas de Bluetooth sur cet appareil", "NO_BLUETOOTH"); return; }
        if (!adapter.isEnabled()) { call.reject("Bluetooth désactivé", "BLUETOOTH_OFF"); return; }

        final byte[] bytes;
        try { bytes = Base64.decode(data, Base64.DEFAULT); }
        catch (IllegalArgumentException e) { call.reject("Données invalides", "BAD_ARGS"); return; }

        // Connexion + écriture hors du thread UI (la connexion RFCOMM bloque 1–3 s)
        new Thread(() -> {
            BluetoothSocket socket = null;
            try {
                BluetoothDevice device = adapter.getRemoteDevice(address);
                try { adapter.cancelDiscovery(); } catch (SecurityException ignored) { }
                try {
                    socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                    socket.connect();
                } catch (IOException first) {
                    // Certaines imprimantes n'acceptent que la variante « insecure »
                    closeQuietly(socket);
                    socket = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                    socket.connect();
                }
                OutputStream out = socket.getOutputStream();
                // Par petits blocs : les imprimantes bon marché perdent des octets
                // quand on envoie tout d'un coup.
                for (int off = 0; off < bytes.length; off += CHUNK) {
                    int len = Math.min(CHUNK, bytes.length - off);
                    out.write(bytes, off, len);
                    out.flush();
                    Thread.sleep(20);
                }
                // Laisser le tampon se vider avant de couper la liaison
                Thread.sleep(400);
                closeQuietly(socket);
                call.resolve();
            } catch (SecurityException e) {
                closeQuietly(socket);
                call.reject("Permission Bluetooth refusée", "PERMISSION_DENIED");
            } catch (IOException e) {
                closeQuietly(socket);
                call.reject("Imprimante injoignable : " + e.getMessage(), "CONNECT_FAILED");
            } catch (InterruptedException e) {
                closeQuietly(socket);
                Thread.currentThread().interrupt();
                call.reject("Impression interrompue", "INTERRUPTED");
            }
        }, "bt-print").start();
    }

    private static void closeQuietly(BluetoothSocket socket) {
        if (socket == null) return;
        try { socket.close(); } catch (IOException ignored) { }
    }
}
