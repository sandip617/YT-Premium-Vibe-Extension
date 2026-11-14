// host.exe - the program Chrome actually starts for the download helper.
// install.ps1 compiles this on the user's PC (Add-Type, built into Windows).
//
// Why it exists: when powershell.exe is started with stdin redirected, it reads part
// of stdin itself, so a PowerShell script can't reliably read Chrome's message.
// This relay reads the framed message (4-byte length + UTF-8 JSON), passes it to
// host.ps1 as a base64 argument (PowerShell gets an empty stdin), and sends host.ps1's
// UTF-8 JSON answer back to Chrome with the 4-byte length in front.
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

class Relay
{
    static byte[] ReadExact(Stream s, int n)
    {
        if (n < 0 || n > 1024 * 1024) return null;
        var buf = new byte[n];
        int got = 0;
        while (got < n)
        {
            int r = s.Read(buf, got, n - got);
            if (r <= 0) return null;
            got += r;
        }
        return buf;
    }

    static void Reply(byte[] json)
    {
        var stdout = Console.OpenStandardOutput();
        stdout.Write(BitConverter.GetBytes(json.Length), 0, 4);
        stdout.Write(json, 0, json.Length);
        stdout.Flush();
    }

    static int Main()
    {
        var stdin = Console.OpenStandardInput();
        var len = ReadExact(stdin, 4);
        if (len == null) return 0;
        var body = ReadExact(stdin, BitConverter.ToInt32(len, 0));
        if (body == null) return 0;

        string script = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "host.ps1");
        var psi = new ProcessStartInfo("powershell.exe",
            "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\" " + Convert.ToBase64String(body));
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardInput = true;
        psi.RedirectStandardOutput = true;

        byte[] answer;
        try
        {
            var p = Process.Start(psi);
            p.StandardInput.Close();
            var ms = new MemoryStream();
            p.StandardOutput.BaseStream.CopyTo(ms);
            p.WaitForExit();
            answer = ms.ToArray();
        }
        catch (Exception e)
        {
            answer = new byte[0];
            try { File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "host.log"), DateTime.Now + " relay: " + e.Message + "\r\n"); } catch { }
        }
        if (answer.Length == 0)
            answer = Encoding.UTF8.GetBytes("{\"ok\":false,\"error\":\"helper\",\"message\":\"The download helper gave no answer. See host.log in %LOCALAPPDATA%\\\\YTPremiumVibe.\"}");
        Reply(answer);
        return 0;
    }
}
