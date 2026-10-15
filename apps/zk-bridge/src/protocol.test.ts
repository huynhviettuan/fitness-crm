import { describe, expect, it } from "vitest";
import { classify, optionsReply, parseAttlog, toInstant } from "./protocol.js";

// The ZKTeco push protocol as the gym's TX628 speaks it (firmware 8.0.4.3, Push Service 2.0.33S; A-308, A-309).

describe("an ATTLOG upload", () => {
  it("gives each punch's user number and local time, and skips what is not a punch", () => {
    const body = [
      "2606002\t2026-10-15 07:30:12\t0\t1\t0\t0\t0",
      "1\t2026-10-15 07:31:00\t0\t1",
      "",
      "bad line",
      "2606003\t15/10/2026 07:30\t0\t1",
      "x y\t2026-10-15 07:30:12\t0\t1",
    ].join("\r\n");
    expect(parseAttlog(body)).toEqual({
      punches: [
        { userCode: "2606002", local: "2026-10-15 07:30:12" },
        { userCode: "1", local: "2026-10-15 07:31:00" },
      ],
      skipped: 3,
    });
  });
});

describe("the machine's clock", () => {
  it("is read in the gym's time zone and sent as an instant", () => {
    expect(toInstant("2026-10-15 07:30:12", "Asia/Ho_Chi_Minh")).toBe("2026-10-15T00:30:12.000Z");
    expect(toInstant("2026-01-01 00:00:00", "Asia/Ho_Chi_Minh")).toBe("2025-12-31T17:00:00.000Z");
    expect(toInstant("2026-07-01 12:00:00", "Europe/Berlin")).toBe("2026-07-01T10:00:00.000Z");
    expect(toInstant("2026-01-01 12:00:00", "Europe/Berlin")).toBe("2026-01-01T11:00:00.000Z");
  });

  it("is refused when it is not a real time", () => {
    expect(toInstant("2026-02-30 07:00:00", "Asia/Ho_Chi_Minh")).toBeNull();
    expect(toInstant("2026-10-15 25:00:00", "Asia/Ho_Chi_Minh")).toBeNull();
    expect(toInstant("soon", "Asia/Ho_Chi_Minh")).toBeNull();
  });
});

describe("the calls of the machine", () => {
  const call = (method: string, path: string) => classify(method, new URL(path, "http://bridge"));

  it("are told apart by path, method and table", () => {
    expect(call("GET", "/iclock/cdata?SN=8116235100093&options=all&pushver=2.0.33")).toEqual({
      kind: "options",
      serialNumber: "8116235100093",
    });
    expect(call("POST", "/iclock/cdata?SN=8116235100093&table=ATTLOG&Stamp=9999")).toEqual({
      kind: "punches",
      serialNumber: "8116235100093",
    });
    expect(call("POST", "/iclock/cdata?SN=8116235100093&table=OPERLOG")).toMatchObject({ kind: "otherTable" });
    expect(call("GET", "/iclock/getrequest?SN=8116235100093")).toMatchObject({ kind: "commands" });
    expect(call("POST", "/iclock/devicecmd?SN=8116235100093")).toMatchObject({ kind: "commandResult" });
  });

  it("without a proper serial number, or elsewhere, are unknown", () => {
    expect(call("GET", "/iclock/cdata")).toEqual({ kind: "unknown" });
    expect(call("GET", "/iclock/cdata?SN=../etc")).toEqual({ kind: "unknown" });
    expect(call("GET", "/other?SN=8116235100093")).toEqual({ kind: "unknown" });
    expect(call("DELETE", "/iclock/cdata?SN=8116235100093")).toEqual({ kind: "unknown" });
  });

  it("are first answered with the options: punches in real time, everything not sent yet, the gym's zone", () => {
    const options = optionsReply("8116235100093", 7);
    expect(options.split("\n")[0]).toBe("GET OPTION FROM: 8116235100093");
    expect(options).toContain("ATTLOGStamp=None");
    expect(options).toContain("Realtime=1");
    expect(options).toContain("TimeZone=7");
  });
});
