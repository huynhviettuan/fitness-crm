import "server-only";
import {
  deviceCreatedSchema,
  deviceListSchema,
  deviceSchema,
  hangingListSchema,
  machineCodeViewSchema,
  manualReportSchema,
  scanPageSchema,
  type DeviceInput,
  type MachineSubject,
} from "@gymcrm/shared/checkin";
import { api, query, read, done } from "./client";

// The fingerprint-ready check-in (M5.3b, D-069 to D-072).

export async function listHanging() {
  const { items } = await read(hangingListSchema, (await api()).GET("/api/v1/checkin/hanging"));
  return items;
}

export async function listScans(params: {
  result?: "WAITING" | "PAIRED" | "ERROR" | "REPEAT";
  page?: number;
  pageSize?: number;
}) {
  return read(scanPageSchema, (await api()).GET("/api/v1/checkin/scans", { params: { query: query(params) } }));
}

export async function getManualReport(params: { from?: string; to?: string }) {
  return read(
    manualReportSchema,
    (await api()).GET("/api/v1/checkin/manual-confirmations", { params: { query: query(params) } }),
  );
}

export async function listDevices() {
  const { items } = await read(deviceListSchema, (await api()).GET("/api/v1/checkin/devices"));
  return items;
}

export async function createDevice(input: DeviceInput) {
  return read(deviceCreatedSchema, (await api()).POST("/api/v1/checkin/devices", { body: input }));
}

export async function updateDevice(id: string, input: { name: string; active: boolean }) {
  return read(
    deviceSchema,
    (await api()).PATCH("/api/v1/checkin/devices/{id}", { params: { path: { id } }, body: input }),
  );
}

export async function rotateDeviceKey(id: string) {
  return read(
    deviceCreatedSchema,
    (await api()).POST("/api/v1/checkin/devices/{id}/key", { params: { path: { id } } }),
  );
}

export async function requestManualConfirmation(bookingId: string) {
  await done((await api()).POST("/api/v1/checkin/hanging/{bookingId}/request", { params: { path: { bookingId } } }));
}

export async function getMachineCode(subject: MachineSubject, id: string) {
  return read(
    machineCodeViewSchema,
    (await api()).GET("/api/v1/checkin/machine-codes/{subject}/{id}", { params: { path: { subject, id } } }),
  );
}

export async function setMachineCode(subject: MachineSubject, id: string, code: string) {
  return read(
    machineCodeViewSchema,
    (await api()).PUT("/api/v1/checkin/machine-codes/{subject}/{id}", {
      params: { path: { subject, id } },
      body: { code },
    }),
  );
}
