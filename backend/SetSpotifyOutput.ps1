# SetSpotifyOutput.ps1
# Spotify'in ses cikisini belirtilen cihaza yonlendirir
# Kullanim: .\SetSpotifyOutput.ps1 -DeviceName "CABLE Input" -Action set|reset

param(
    [string]$DeviceName = "CABLE Input",
    [string]$Action = "set"
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
interface IMMDeviceEnumerator {}

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator2 {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection ppDevices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
    int GetDevice(string pwstrId, out IMMDevice ppDevice);
    int RegisterEndpointNotificationCallback(IntPtr pClient);
    int UnregisterEndpointNotificationCallback(IntPtr pClient);
}

[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection {
    int GetCount(out uint pcDevices);
    int Item(uint nDevice, out IMMDevice ppDevice);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, out IntPtr ppInterface);
    int OpenPropertyStore(int stgmAccess, out IPropertyStore ppProperties);
    int GetId(out string ppstrId);
    int GetState(out int pdwState);
}

[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore {
    int GetCount(out uint cProps);
    int GetAt(uint iProp, out PropertyKey pkey);
    int GetValue(ref PropertyKey key, out PropVariant pv);
    int SetValue(ref PropertyKey key, ref PropVariant propvar);
    int Commit();
}

[StructLayout(LayoutKind.Sequential)]
public struct PropertyKey {
    public Guid fmtid;
    public uint pid;
}

[StructLayout(LayoutKind.Sequential)]
public struct PropVariant {
    public ushort vt;
    public ushort wReserved1, wReserved2, wReserved3;
    public IntPtr p;
    public int p2;
}

public class AudioDeviceHelper {
    [DllImport("ole32.dll")]
    public static extern int CoCreateInstance(ref Guid rclsid, IntPtr pUnkOuter, int dwClsContext, ref Guid riid, out IMMDeviceEnumerator2 ppv);
    
    public static List<string[]> GetOutputDevices() {
        var result = new List<string[]>();
        Guid clsid = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
        Guid iid = new Guid("A95664D2-9614-4F35-A746-DE8DB63617E6");
        IMMDeviceEnumerator2 enumerator;
        CoCreateInstance(ref clsid, IntPtr.Zero, 1, ref iid, out enumerator);
        IMMDeviceCollection collection;
        enumerator.EnumAudioEndpoints(0, 1, out collection); // eRender, DEVICE_STATE_ACTIVE
        uint count;
        collection.GetCount(out count);
        for (uint i = 0; i < count; i++) {
            IMMDevice device;
            collection.Item(i, out device);
            string id;
            device.GetId(out id);
            IPropertyStore store;
            device.OpenPropertyStore(0, out store);
            PropertyKey key = new PropertyKey();
            key.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
            key.pid = 14;
            PropVariant pv;
            store.GetValue(ref key, out pv);
            string name = Marshal.PtrToStringUni(pv.p);
            result.Add(new string[] { id, name ?? "" });
        }
        return result;
    }
}
"@ -ErrorAction SilentlyContinue

# Cihazlari listele ve CABLE Input'u bul
try {
    $devices = [AudioDeviceHelper]::GetOutputDevices()
    $cable = $null
    foreach ($d in $devices) {
        if ($d[1] -like "*CABLE Input*" -or $d[1] -like "*VB-Audio*") {
            $cable = $d
            break
        }
    }
    if ($cable) {
        Write-Output "FOUND:$($cable[1])|$($cable[0])"
    } else {
        Write-Output "NOTFOUND"
    }
} catch {
    Write-Output "ERROR:$($_.Exception.Message)"
}
