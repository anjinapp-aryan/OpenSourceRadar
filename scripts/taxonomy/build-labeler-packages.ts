/**
 * Phase 6.3.2: build the two independent labeler packages from the blind sheet. Each package holds ONLY a sheet and a guide.
 *
 *   tsx scripts/taxonomy/build-labeler-packages.ts [--sheet results/phase6.3.1/labelling/sheet.csv] [--out results/phase6.3.2/labeler-packages]
 *
 * The sheet columns up to `ageDays` are copied unchanged (so ids and text match the key); the label columns are rebuilt to the 6.3.2 design.
 * The guide is clean: it names no key, prediction, score or assistant file. A package that contains anything else, or a forbidden word, is a bug
 * and the script throws.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTaxonomyV2 } from '../../src/taxonomy';
import { parseCsv, toCsv } from '../../src/taxonomy/csv';

const argv = process.argv.slice(2);
const arg = (n: string, d: string) => (argv.includes(n) ? (argv[argv.indexOf(n) + 1] as string) : d);
const sheetPath = arg('--sheet', 'results/phase6.3.1/labelling/sheet.csv');
const outDir = arg('--out', 'results/phase6.3.2/labeler-packages');

const LABEL_COLUMNS = ['domainEngineering', 'areas', 'technologies', 'technologiesUsed', 'learning', 'confidence', 'type', 'notes'];
const FORBIDDEN = /sample-key|scores?-|assistant|prediction|predicted|classifier output|stratum|strata|weight|ground truth|expected label/i;

const rows = parseCsv(readFileSync(sheetPath, 'utf8'));
const header = rows[0] as string[];
const cut = header.indexOf('ageDays') + 1;
if (cut < 1) throw new Error('sheet has no ageDays column');
const body = rows.slice(1).filter((r) => r.length > 1);
const tax = loadTaxonomyV2();
const techs = tax.technologies.map((t) => t.slug);
const areas = tax.engineeringAreas.map((a) => a.slug);

const sheet = toCsv([[...header.slice(0, cut), ...LABEL_COLUMNS], ...body.map((r) => [...r.slice(0, cut), ...LABEL_COLUMNS.map(() => '')])]);

const guide = (who: string) => `# Labeling guide, labeler ${who}

You are one of two people who label the same ${body.length} repositories **independently**. Do not discuss the repositories, your answers or your doubts with the other labeler, and do not look anything up about how a tool classifies them. Judge each repository from the information in the sheet (name, description, topics, language, stars, age) and, where that is not enough, from its public page. Return **only your own completed \`sheet.csv\`**, with your name in the file name.

Spreadsheet or text editor; save as CSV (UTF-8). Do not add, remove, rename or reorder columns or rows. Leave a row's label cells empty if you cannot judge it; do not guess.

## Columns to fill
| Column | Allowed values |
|---|---|
| \`domainEngineering\` | \`YES\`, \`NO\`, \`UNCERTAIN\`. Is this software that an engineer would evaluate as an engineering technology, framework, infrastructure project or developer tool? AI models, AI agents, AI applications and consumer applications are \`NO\`. Lists, courses and notes **about** engineering subjects are \`YES\` here. |
| \`areas\` | zero or more of: ${areas.map((a) => `\`${a}\``).join(', ')} (separate with \`;\`). Empty if none fits or if \`domainEngineering\` is \`NO\`. |
| \`technologies\` | zero or more technology slugs (list below) for which the repository is **primarily about** that technology: it implements it, extends it, is a client or tool for it, or integrates it as its main purpose. Separate with \`;\`. |
| \`technologiesUsed\` | zero or more technology slugs the repository **touches or uses** in any significant way, including those in \`technologies\` and including technologies it merely runs on or depends on (for example a web application that is deployed with Docker and stores data in PostgreSQL). Separate with \`;\`. |
| \`learning\` | \`YES\` (tutorial, course, interview preparation, awesome list, notes, example collection), \`NO\`, \`UNCERTAIN\`. |
| \`confidence\` | \`HIGH\`, \`MEDIUM\`, \`LOW\`: how sure you are of this row overall. |
| \`type\` | \`library\`, \`framework\`, \`tool\`, \`infrastructure\`, \`application\`, \`educational\`, \`other\`. Required on every labeled row. |
| \`notes\` | optional free text. |

Do not label a technology only because its name appears in the repository name or a topic. Use \`UNCERTAIN\` honestly.

## Technology slugs
${techs.map((t) => `\`${t}\``).join(', ')}

## Rules
1. Work alone and blind. Disagreements between labelers are expected and are resolved later by a person, not by you.
2. Label at least 200 rows; label all ${body.length} if you can.
3. A repository can have no technology at all. Leave both technology columns empty in that case.
4. Do not edit the first ${cut} columns.
`;

const stripped = guide('A');
if (FORBIDDEN.test(stripped.replace(/ground truth/gi, ''))) throw new Error('guide contains a forbidden word');
for (const who of ['A', 'B']) {
  const dir = join(outDir, `LABELER_${who}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sheet.csv'), sheet);
  writeFileSync(join(dir, 'LABELING-GUIDE.md'), guide(who));
  const files = readdirSync(dir).sort();
  if (files.join(',') !== 'LABELING-GUIDE.md,sheet.csv') throw new Error(`package ${who} holds unexpected files: ${files.join(',')}`);
}
console.log(JSON.stringify({ rows: body.length, columns: header.slice(0, cut).concat(LABEL_COLUMNS), packages: ['LABELER_A', 'LABELER_B'], out: outDir }));
