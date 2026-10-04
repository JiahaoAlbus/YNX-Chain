using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace YNXDeveloper;

// Lifecycle primitive for a future sealed local-workbench entry. The existing
// hosted MainWindow does not call it. A suspended child is assigned to our Job
// before any Node/project code runs. No external PID can enter this component.
internal sealed class WindowsJobProcess : IAsyncDisposable
{
    const uint CreateSuspended = 0x00000004, CreateNoWindow = 0x08000000, CreateUnicodeEnvironment = 0x00000400;
    const uint KillOnJobClose = 0x00002000, Infinite = 0xffffffff, WaitObject0 = 0;
    readonly KernelHandle job, process;
    readonly FileStream profileLock;
    readonly Task<uint> exit;
    readonly object disposeGate = new();
    Task? disposing;
    public uint ProcessId { get; }
    public Task<uint> Exit => exit;

    WindowsJobProcess(KernelHandle job, KernelHandle process, FileStream profileLock, uint processId)
    {
        this.job = job; this.process = process; this.profileLock = profileLock; ProcessId = processId;
        exit = Task.Run(() => {
            try {
                if (WaitForSingleObject(process, Infinite) != WaitObject0) throw new Win32Exception(Marshal.GetLastWin32Error());
                if (!GetExitCodeProcess(process, out var code)) throw new Win32Exception(Marshal.GetLastWin32Error());
                return code;
            } finally {
                // Cleanup completes before Exit resolves. The wait keeps the
                // process handle alive until its last native operation ends.
                job.Dispose(); process.Dispose(); profileLock.Dispose();
            }
        });
        // A crashed/finished backend cannot leave detached PTYs or helpers alive.
        // Closing this one owned Job never touches another app's process tree.
    }

    public static WindowsJobProcess Start(string executable, IReadOnlyList<string> arguments,
        string workingDirectory, string profileDirectory, IReadOnlyDictionary<string, string> environment)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Windows local workbench requires Windows.");
        // This primitive verifies executable location, not runtime provenance.
        // A real entry must inspect the payload/tree/version and establish its
        // project/isolation policy before invoking Start.
        var expected = Path.Combine(AppContext.BaseDirectory, "Resources", "runtime", "node.exe");
        if (!Path.GetFullPath(executable).Equals(Path.GetFullPath(expected), StringComparison.OrdinalIgnoreCase))
            throw new IOException("Only the installed bundled Node executable can start a local workbench.");
        LocalWorkbenchPayload.RequireCanonical(executable, false);
        LocalWorkbenchPayload.RequireCanonical(workingDirectory, true);
        LocalWorkbenchPayload.RequireCanonical(profileDirectory, true);
        LocalWorkbenchPayload.RequireWithin(profileDirectory, ProfileStorage.Root);
        var lockPath = Path.Combine(profileDirectory, "local-workbench.lock");
        if (File.Exists(lockPath)) LocalWorkbenchPayload.RequireCanonical(lockPath, false);
        FileStream? lease = null; KernelHandle? job = null, child = null, thread = null;
        IntPtr block = IntPtr.Zero; bool created = false, transferred = false;
        try
        {
            // Reuses the existing OS-user profile boundary; never a PID lease or
            // canonical Wallet identity. An alive second profile writer is denied.
            lease = new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            job = new KernelHandle(CreateJobObjectW(IntPtr.Zero, null));
            if (job.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            var limits = new ExtendedLimitInformation { BasicLimitInformation = new BasicLimitInformation { LimitFlags = KillOnJobClose } };
            if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimitInformation>())) throw new Win32Exception(Marshal.GetLastWin32Error());
            var entries = environment.OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase).Select(pair => {
                if (pair.Key.Length == 0 || pair.Key.Contains('=') || pair.Key.Contains('\0') || pair.Value.Contains('\0')) throw new ArgumentException("Invalid local runtime environment.");
                return pair.Key + "=" + pair.Value;
            });
            var text = string.Join("\0", entries) + "\0\0";
            if (text.Length > 32767) throw new ArgumentException("Local runtime environment exceeds its limit.");
            block = Marshal.StringToHGlobalUni(text);
            var command = new StringBuilder(string.Join(" ", new[] { executable }.Concat(arguments).Select(QuoteArgument)));
            if (command.Length >= 32767) throw new ArgumentException("Local runtime command exceeds its limit.");
            var startup = new StartupInfo { cb = (uint)Marshal.SizeOf<StartupInfo>() };
            if (!CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, false,
                CreateSuspended | CreateNoWindow | CreateUnicodeEnvironment, block, workingDirectory, ref startup, out var info))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            created = true; child = new KernelHandle(info.hProcess); thread = new KernelHandle(info.hThread);
            if (!AssignProcessToJobObject(job, child)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (ResumeThread(thread) == uint.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error());
            var result = new WindowsJobProcess(job, child, lease, info.dwProcessId);
            transferred = true; return result;
        }
        finally
        {
            if (block != IntPtr.Zero) Marshal.FreeHGlobal(block);
            thread?.Dispose();
            if (!transferred)
            {
                // This handle was returned by our own CREATE_SUSPENDED call.
                // It is never looked up by PID, so startup failure cannot target
                // an unrelated process or another application's Job.
                if (created && child != null && !child.IsInvalid) TerminateProcess(child, 1);
                job?.Dispose(); child?.Dispose(); lease?.Dispose();
            }
        }
    }

    public ValueTask DisposeAsync()
    {
        lock (disposeGate) return new ValueTask(disposing ??= StopOwnedAsync());
    }
    async Task StopOwnedAsync()
    {
        job.Dispose(); // Kernel kills every descendant, including separate PTYs.
        try { await exit.ConfigureAwait(false); }
        finally { process.Dispose(); profileLock.Dispose(); }
    }
    internal static string QuoteArgument(string value)
    {
        if (value.Contains('\0')) throw new ArgumentException("Invalid process argument.");
        var result = new StringBuilder("\""); int slashes = 0;
        foreach (var character in value) {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') { result.Append('\\', slashes * 2 + 1).Append('"'); slashes = 0; continue; }
            result.Append('\\', slashes).Append(character); slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }
    sealed class KernelHandle : SafeHandleZeroOrMinusOneIsInvalid
    {
        internal KernelHandle(IntPtr value) : base(true) { SetHandle(value); }
        protected override bool ReleaseHandle() => CloseHandle(handle);
    }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimitInformation { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimitInformation { public BasicLimitInformation BasicLimitInformation; public IoCounters IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct StartupInfo { public uint cb; public string? lpReserved, lpDesktop, lpTitle; public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public ushort wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInformation { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool SetInformationJobObject(KernelHandle job, int informationClass, ref ExtendedLimitInformation information, uint length);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInformation process);
    [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool AssignProcessToJobObject(KernelHandle job, KernelHandle process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(KernelHandle thread);
    [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool TerminateProcess(KernelHandle process, uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(KernelHandle handle, uint timeout);
    [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool GetExitCodeProcess(KernelHandle process, out uint code);
    [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool CloseHandle(IntPtr handle);
}
