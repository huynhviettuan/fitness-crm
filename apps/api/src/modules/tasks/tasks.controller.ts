import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  taskAssigneesSchema,
  taskCommentSchema,
  taskDetailSchema,
  taskInputSchema,
  taskPageSchema,
  taskSummarySchema,
  taskUpdateSchema,
} from "@flow/shared/tasks";
import { AnySignedInUser, CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import {
  addComment,
  createTask,
  getTask,
  listTasks,
  moveTask,
  taskAssignees,
  taskSummary,
  updateTask,
} from "./task.service.js";

const FILTERS = ["view", "status", "overdueOnly", "q", "page", "pageSize"] as const;

/** Giao việc (brief §8.2, D-037). */
@ApiTags("tasks")
@ApiErrors()
@Controller("tasks")
export class TasksController {
  @Get()
  @RequirePermission("task.view")
  @ApiOptionalQuery(...FILTERS)
  @ApiResult(taskPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(taskPageSchema, await listTasks(actor, queryOf(request, FILTERS)));
  }

  /** My open and overdue tasks, for the menu; zero without task.view. */
  @Get("summary")
  @AnySignedInUser()
  @ApiResult(taskSummarySchema)
  async summary(@CurrentActor() actor: CurrentUser) {
    return encode(taskSummarySchema, await taskSummary(actor));
  }

  /** People and departments a task can go to. */
  @Get("assignees")
  @RequirePermission("task.view")
  @ApiResult(taskAssigneesSchema)
  async assignees(@CurrentActor() actor: CurrentUser) {
    return encode(taskAssigneesSchema, await taskAssignees(actor));
  }

  @Post()
  @RequirePermission("task.create")
  @ApiResult(taskDetailSchema, 201, "Created")
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: taskInputSchema }) body: unknown) {
    return encode(taskDetailSchema, await createTask(actor, body));
  }

  @Get(":id")
  @RequirePermission("task.view")
  @ApiResult(taskDetailSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(taskDetailSchema, await getTask(actor, id));
  }

  /** The assigner edits an open task; a new assignee has to accept it again. */
  @Patch(":id")
  @RequirePermission("task.view")
  @ApiResult(taskDetailSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: taskUpdateSchema }) body: unknown,
  ) {
    return encode(taskDetailSchema, await updateTask(actor, id, body));
  }

  /** The assignee, or a member of the department it went to. */
  @Post(":id/accept")
  @RequirePermission("task.view")
  @HttpCode(200)
  @ApiResult(taskDetailSchema)
  async accept(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(taskDetailSchema, await moveTask(actor, id, "accept"));
  }

  @Post(":id/start")
  @RequirePermission("task.view")
  @HttpCode(200)
  @ApiResult(taskDetailSchema)
  async start(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(taskDetailSchema, await moveTask(actor, id, "start"));
  }

  @Post(":id/complete")
  @RequirePermission("task.view")
  @HttpCode(200)
  @ApiResult(taskDetailSchema)
  async complete(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(taskDetailSchema, await moveTask(actor, id, "complete"));
  }

  /** The assigner, or someone who sees every task of the branch. */
  @Post(":id/cancel")
  @RequirePermission("task.view")
  @HttpCode(200)
  @ApiResult(taskDetailSchema)
  async cancel(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(taskDetailSchema, await moveTask(actor, id, "cancel"));
  }

  @Post(":id/comments")
  @RequirePermission("task.view")
  @ApiResult(taskDetailSchema, 201, "Comment added")
  async comment(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: taskCommentSchema }) body: unknown,
  ) {
    return encode(taskDetailSchema, await addComment(actor, id, body));
  }
}
