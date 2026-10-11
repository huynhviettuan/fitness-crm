import "server-only";
import {
  optionListSchema,
  optionSchema,
  otherNoteListSchema,
  type OptionInput,
  type OptionListKey,
} from "@flow/shared/options";
import { parametersSchema, type ParametersInput } from "@flow/shared/parameters";
import { api, read } from "./client";

// Option lists (D-016) and system parameters (T-049).

export async function listOptions(listKey: OptionListKey, includeInactive = false) {
  const { items } = await read(
    optionListSchema,
    (await api()).GET("/api/v1/option-lists/{key}/options", {
      params: { path: { key: listKey }, query: { includeInactive: String(includeInactive) } },
    }),
  );
  return items;
}

export async function createOption(listKey: OptionListKey, input: OptionInput) {
  return read(
    optionSchema,
    (await api()).POST("/api/v1/option-lists/{key}/options", { params: { path: { key: listKey } }, body: input }),
  );
}

export async function updateOption(listKey: OptionListKey, id: string, input: OptionInput) {
  return read(
    optionSchema,
    (await api()).PATCH("/api/v1/option-lists/{key}/options/{id}", {
      params: { path: { key: listKey, id } },
      body: input,
    }),
  );
}

export async function reorderOptions(listKey: OptionListKey, optionIds: string[]) {
  const { items } = await read(
    optionListSchema,
    (await api()).PUT("/api/v1/option-lists/{key}/order", { params: { path: { key: listKey } }, body: { optionIds } }),
  );
  return items;
}

export async function listOtherNotes(listKey: OptionListKey) {
  const { items } = await read(
    otherNoteListSchema,
    (await api()).GET("/api/v1/option-lists/{key}/other-notes", { params: { path: { key: listKey } } }),
  );
  return items;
}

export async function getParameters() {
  return read(parametersSchema, (await api()).GET("/api/v1/parameters"));
}

export async function updateParameters(input: ParametersInput) {
  return read(parametersSchema, (await api()).PUT("/api/v1/parameters", { body: input }));
}
