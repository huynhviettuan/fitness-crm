import "server-only";
import {
  intakeSourceCreatedSchema,
  intakeSourceListSchema,
  intakeSourceSchema,
  messageListSchema,
  type IntakeSourceInput,
  type IntakeSourceUpdate,
} from "@flow/shared/intake";
import { api, read } from "./client";

// The lead intake gateway (brief §11, D-044; M10.1): the sources Admin registers, and the conversation stored on a person.

export async function listIntakeSources() {
  const { items } = await read(intakeSourceListSchema, (await api()).GET("/api/v1/intake/sources"));
  return items;
}

export async function createIntakeSource(input: IntakeSourceInput) {
  return read(intakeSourceCreatedSchema, (await api()).POST("/api/v1/intake/sources", { body: input as never }));
}

export async function updateIntakeSource(id: string, input: IntakeSourceUpdate) {
  return read(
    intakeSourceSchema,
    (await api()).PATCH("/api/v1/intake/sources/{id}", { params: { path: { id } }, body: input as never }),
  );
}

export async function rotateIntakeSourceKey(id: string) {
  return read(
    intakeSourceCreatedSchema,
    (await api()).POST("/api/v1/intake/sources/{id}/key", { params: { path: { id } } }),
  );
}

export async function listPersonMessages(personId: string) {
  const { items } = await read(
    messageListSchema,
    (await api()).GET("/api/v1/persons/{id}/messages", { params: { path: { id: personId } } }),
  );
  return items;
}
