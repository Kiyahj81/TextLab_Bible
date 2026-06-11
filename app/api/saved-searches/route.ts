import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { bookName } from "@/lib/references";
import { requireAuth } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/http/security";
import { readJsonLimited, validateBody } from "@/lib/http/validation";

const MAX_LABEL = 100;
const MAX_QUERY = 500;
const MAX_CORPUS = 100;
const MAX_BOOK = 100;
const MAX_DOMAIN_FIELD = 20;

const savedSearchCreateSchema = z
  .object({
    query: z.string().trim().min(1).max(MAX_QUERY).optional(),
    mode: z.enum(["keyword", "lemma", "morphology", "domain"]).default("keyword"),
    matchMode: z.enum(["exact", "prefix"]).optional(),
    corpus: z.string().trim().max(MAX_CORPUS).optional(),
    book: z.string().trim().max(MAX_BOOK).optional(),
    chapter: z.coerce.number().int().positive().optional(),
    domain: z.string().trim().min(1).max(MAX_DOMAIN_FIELD).optional(),
    subdomain: z.string().trim().min(1).max(MAX_DOMAIN_FIELD).optional(),
    ln: z.string().trim().min(1).max(MAX_DOMAIN_FIELD).optional(),
    label: z.string().trim().max(MAX_LABEL).optional()
  })
  .superRefine((value, ctx) => {
    if (value.mode === "domain") {
      if (!value.domain && !value.subdomain && !value.ln) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A domain saved search needs a domain, subdomain, or LN reference."
        });
      }
      if (value.query) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Domain saved searches do not take a query." });
      }
    } else if (!value.query) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Query is required." });
    }
  });

function autoLabel({
  mode,
  query,
  book,
  chapter,
  domain,
  subdomain,
  ln
}: {
  mode: string;
  query?: string;
  book?: string;
  chapter?: number;
  domain?: string;
  subdomain?: string;
  ln?: string;
}) {
  const subject = mode === "domain" ? (ln ?? subdomain ?? domain ?? "") : (query ?? "");
  if (!book) return `${mode}: ${subject}`;
  const scope = chapter ? `${bookName(book)} ${chapter}` : bookName(book);
  return `${mode}: ${subject} (${scope})`;
}

export async function GET() {
  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult;

  const savedSearches = await prisma.savedSearch.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 25
  });

  return NextResponse.json({ savedSearches });
}

export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) return origin.response;

  const authResult = await requireAuth();
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult;

  const read = await readJsonLimited(request);
  if (!read.ok) return read.response;

  const valid = validateBody(read.data, savedSearchCreateSchema);
  if (!valid.ok) return valid.response;

  const { query, mode, matchMode: rawMatchMode, corpus, book, chapter, domain, subdomain, ln, label: rawLabel } =
    valid.data;

  const isDomain = mode === "domain";
  const matchMode = mode === "morphology" ? rawMatchMode : undefined;
  const label = rawLabel || autoLabel({ mode, query, book, chapter, domain, subdomain, ln });

  const savedSearch = await prisma.savedSearch.create({
    data: {
      userId,
      label,
      mode,
      query: isDomain ? null : (query ?? null),
      corpus,
      book,
      chapter,
      matchMode,
      domain: isDomain ? domain ?? null : null,
      subdomain: isDomain ? subdomain ?? null : null,
      ln: isDomain ? ln ?? null : null
    }
  });

  return NextResponse.json({ savedSearch }, { status: 201 });
}
