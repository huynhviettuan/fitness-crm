# 33. ZKTeco bridge (setup and operation)

Brief §6.6, D-069 to D-072, A-218, A-306 to A-309. For whoever sets up the fingerprint machine at the gym. Built 2026-10-15
(`apps/zk-bridge`).

## 1. What it is and why

The gym's ZKTeco TX628 can **push** every punch to a server (*Cloud Server Setting*, ADMS, A-308). It does not
push to the CRM directly: the machine proves itself only by its serial number, printed on its label and shown in its menu, and a
punch confirms a session, takes it off the contract and credits the PT (D-069). So the machine pushes to a **small program on the
gym's LAN**, the bridge, which sends the punches to the CRM over HTTPS with the machine's own key (A-153), the key that only the
CRM's Admin sees once.

```
TX628 (192.168.1.50) --push, LAN--> bridge on a gym computer --HTTPS + machine key--> CRM  POST /api/v1/checkin/scans
```

The CRM pairs the punches with booked sessions as it does for any machine (D-070): nothing in the CRM changes. The bridge stores
nothing but the punches waiting to be sent (user number, time); no fingerprint ever leaves the machine (D-072).

## 2. What the bridge does

- Answers the machine's calls (`/iclock/cdata`, `/iclock/getrequest`, `/iclock/devicecmd`), only for the machines in its settings,
  by serial number (any other is refused and logged).
- Takes each punch (user number and the machine's local time), reads the time in the gym's time zone, **writes it to its queue file
  before telling the machine "OK"**, and sends what waits to the CRM, at most 500 a call.
- When the CRM cannot be reached, refuses the key, or fails, the punches stay in the queue and are sent later (waiting longer after
  each failure, up to five minutes). The CRM answers a punch sent twice with the first answer, so nothing is counted twice; the
  CRM pairs by the machine's own time, so a punch sent late still confirms its session.
- Ignores the machine's other records (users enrolled, operations).
- `GET /health` says how many punches wait, when the last send worked and the last error. It never shows a key.

## 3. Setting it up

The short way (M5.8b, A-310): `pnpm --filter zk-bridge package` writes `apps/zk-bridge/release/gymcrm-zk-bridge/`; zip it and copy it to
the gym's computer, then follow its `HUONG-DAN.txt` (the setup guide in Vietnamese): fill
`zk-bridge.json`, run `install-windows.ps1` as Administrator (it checks Node.js and the settings, checks each key against the CRM
with `--check`, opens the port to the local subnet, and registers the task *Gym CRM ZK Bridge* that starts at boot and again within 5
minutes if it stopped), then set the machine (step 4 below). `node main.js --config zk-bridge.json --check` can be run at any time:
it prints, for each machine, "OK … khóa hợp lệ — máy …, chi nhánh …" or "LỖI …" and the clock difference.

The steps in detail:

1. **In the CRM** (Admin): *Check-in → Máy chấm công → Thêm máy*, the branch and a name ("TX628 quầy lễ tân"); copy the **key** shown once.
   On each customer and employee, the *Mã người dùng trên máy* is the number the machine knows them by (D-072).
2. **On the gym computer** (Windows, Node.js 22 or later): copy the built bridge (`apps/zk-bridge/dist`, after
   `pnpm --filter zk-bridge build`) and make `zk-bridge.json` from `apps/zk-bridge/zk-bridge.example.json`:
   - `apiUrl`: the CRM's address (`https://…`; the bridge refuses plain http to anything but the computer itself);
   - `machines`: the serial number (*Menu → Thông tin hệ thống → Thông tin thiết bị → Số sê ri*, for example `1234567890123`) and the key;
   - `listenPort`: 8081 (the port the machine is set to);
   - `queueFile`: where waiting punches are kept.
   The file holds the key: keep it on that computer, readable only by the account that runs the bridge.
3. **Run it**: `node dist/main.js --config zk-bridge.json`. It prints one JSON line per event (connected, punches received, sent,
   not sent with the reason). Keep it running with Windows Task Scheduler ("at startup", restart on failure) or a service wrapper.
   Allow inbound TCP 8081 on that computer's firewall for the LAN.
4. **On the machine** (*Menu → Truyền thông → Cài đặt máy chủ đám mây*): server type *Tự động tải dữ liệu*, **server address** the
   bridge computer's LAN address (for example `192.168.1.10`; give that computer a fixed address in the router), **port** 8081,
   domain names **off**, proxy **off**, **HTTPS off** (the bridge listens on the LAN in plain HTTP; the CRM leg is HTTPS). The
   machine's gateway can stay `0.0.0.0`: it only talks to the LAN.
5. **Check**: open `http://<bridge computer>:8081/health`; the bridge's log shows "machine connected", then "punches received" and
   "sent" after a scan; the scan appears in the CRM (*Check-in → Tất cả lần quét*).

## 4. With the previous software during the parallel run

An existing fingerprint reader software on the reception computer may read the machine over port 4370; the push is a separate
channel, so both can run side by side (to be confirmed by the installer, OQ-062). The bridge may run on that same computer.

## 5. Open (OQ-062)

- The reception computer may be off when early sessions start. While the bridge is off the machine keeps its punches and
  sends them when the bridge answers again (the push resends what was not acknowledged; to be confirmed with ZKTeco's document),
  and the CRM pairs them by their own time, but a session is confirmed only then. An always-on mini computer, or the PC left on
  during opening hours, avoids the delay.
- The protocol details follow the published push protocol of this firmware generation; ZKTeco's own document for the tested
  firmware is still awaited, and the first run at the gym is the real test.
- A machine without an administrator (A-308) lets anyone change its settings or delete its data. Set one before connecting.
- Whether PTs scan on the same machine, and whether the machine's user numbers are the previous system's (so nobody enrols again).
