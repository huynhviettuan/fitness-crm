import { Controller, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import { ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { fileLinkSchema, storedFileSchema } from "@flow/shared/files";
import { AnySignedInUser, CurrentActor } from "../auth/auth.guard.js";
import type { CurrentUser } from "../auth/session.js";
import { encode } from "../http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../http/openapi.js";
import { queryOf } from "../http/query.js";
import { fileContent, fileLink, uploadFile } from "./file.service.js";

/** Private pictures (T-052, A-143, A-144): upload, a signed link, and the bytes behind that link. */
@ApiTags("files")
@ApiErrors()
@Controller("files")
export class FilesController {
  /**
   * The picture itself is the request body (PNG, JPEG, or WebP up to 5 MB) with its own content type; `purpose` says
   * what it is for. The service checks the permission of that purpose, so the guard only needs a signed-in user.
   */
  @Post()
  @AnySignedInUser()
  @HttpCode(201)
  @ApiOptionalQuery("purpose")
  @ApiResult(storedFileSchema, 201, "Stored")
  async upload(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(storedFileSchema, await uploadFile(actor, queryOf(request, ["purpose"]), request.body));
  }

  /** A signed link, valid for five minutes, to fetch the file; only for someone who may see what it belongs to. */
  @Get(":id/link")
  @AnySignedInUser()
  @ApiResult(fileLinkSchema)
  async link(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(fileLinkSchema, await fileLink(actor, id));
  }

  /** The bytes, for the link made for the signed-in user. */
  @Get(":id/content")
  @AnySignedInUser()
  @ApiOptionalQuery("expires", "signature")
  @ApiResponse({
    status: 200,
    description: "The picture",
    content: { "image/png": { schema: { type: "string", format: "binary" } } },
  })
  async content(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const { bytes, contentType } = await fileContent(actor, id, queryOf(request, ["expires", "signature"]));
    response
      .status(200)
      .set({
        "content-type": contentType,
        "content-length": String(bytes.length),
        "content-disposition": "inline",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      })
      .end(bytes);
  }
}
