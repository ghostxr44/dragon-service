using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using Microsoft.Win32;

enum ERole { eConsole = 0, eMultimedia = 1, eCommunications = 2 }
enum EDataFlow { eRender = 0, eCapture = 1 }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(EDataFlow dataFlow, int stateMask, out IMMDeviceCollection ppDevices);
    int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppEndpoint);
    int GetDevice(string pwstrId, out IMMDevice ppDevice);
    int RegisterEndpointNotificationCallback(IntPtr pClient);
    int UnregisterEndpointNotificationCallback(IntPtr pClient);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumerator {}

[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection {
    int GetCount(out uint pcDevices);
    int Item(uint nDevice, out IMMDevice ppDevice);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, out IntPtr ppInterface);
    int OpenPropertyStore(int stgmAccess, out IPropertyStore ppProperties);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
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
struct PropertyKey { public Guid fmtid; public uint pid; }

[StructLayout(LayoutKind.Sequential)]
struct PropVariant {
    public ushort vt; public ushort r1, r2, r3;
    public IntPtr p; public int p2;
}

class Program {
    static IMMDeviceEnumerator GetEnumerator() {
        return (IMMDeviceEnumerator)new MMDeviceEnumerator();
    }

    static string GetDeviceName(IMMDevice dev) {
        IPropertyStore store; dev.OpenPropertyStore(0, out store);
        var key = new PropertyKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
        PropVariant pv; store.GetValue(ref key, out pv);
        return Marshal.PtrToStringUni(pv.p) ?? "";
    }

    static string FindDeviceId(IMMDeviceEnumerator enumerator, string nameFilter) {
        IMMDeviceCollection col;
        enumerator.EnumAudioEndpoints(EDataFlow.eRender, 1, out col);
        uint count; col.GetCount(out count);
        for (uint i = 0; i < count; i++) {
            IMMDevice dev; col.Item(i, out dev);
            string id; dev.GetId(out id);
            if (GetDeviceName(dev).IndexOf(nameFilter, StringComparison.OrdinalIgnoreCase) >= 0)
                return id;
        }
        return null;
    }

    static string GetDefaultDeviceId(IMMDeviceEnumerator enumerator) {
        IMMDevice dev;
        enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out dev);
        string id; dev.GetId(out id);
        return id;
    }

    // Per-app routing registry key'ini guncelle — sistem default'u degistirmez
    static void SetPerAppDevice(string deviceId) {
        const string regBase = @"Software\Microsoft\Internet Explorer\LowRegistry\Audio\PolicyConfig\PropertyStore";
        using (var store = Registry.CurrentUser.OpenSubKey(regBase, true)) {
            if (store == null) { Console.WriteLine("ERROR:Registry key not found"); return; }
            bool found = false;
            foreach (var subKeyName in store.GetSubKeyNames()) {
                using (var sub = store.OpenSubKey(subKeyName, true)) {
                    if (sub == null) continue;
                    var val = sub.GetValue("") as string;
                    if (val == null || val.IndexOf("Spotify.exe", StringComparison.OrdinalIgnoreCase) < 0) continue;
                    // Pipe'dan sonraki kismi koru (exe path + guid)
                    int pipeIdx = val.IndexOf('|');
                    if (pipeIdx < 0) continue;
                    string exePart = val.Substring(pipeIdx);
                    // Yeni deger: {2}.deviceId|exePart
                    string newVal = "{2}." + deviceId + exePart;
                    sub.SetValue("", newVal, RegistryValueKind.String);
                    Console.WriteLine("SET:" + subKeyName + "->" + deviceId);
                    found = true;
                }
            }
            if (!found) Console.WriteLine("NOTFOUND:No Spotify registry entry. Play a song first.");
        }
    }

    static void Main(string[] args) {
        string action = args.Length > 0 ? args[0] : "list";
        string targetName = args.Length > 1 ? args[1] : "CABLE Input";

        var enumerator = GetEnumerator();

        if (action == "list") {
            IMMDeviceCollection col;
            enumerator.EnumAudioEndpoints(EDataFlow.eRender, 1, out col);
            uint count; col.GetCount(out count);
            for (uint i = 0; i < count; i++) {
                IMMDevice dev; col.Item(i, out dev);
                string id; dev.GetId(out id);
                Console.WriteLine("DEVICE:" + id + "|" + GetDeviceName(dev));
            }
            return;
        }

        if (action == "set") {
            string targetId = FindDeviceId(enumerator, targetName);
            if (targetId == null) { Console.WriteLine("ERROR:Device not found: " + targetName); return; }
            SetPerAppDevice(targetId);
            return;
        }

        if (action == "reset") {
            string defaultId = GetDefaultDeviceId(enumerator);
            SetPerAppDevice(defaultId);
            Console.WriteLine("RESET:" + defaultId);
            return;
        }
    }
}
