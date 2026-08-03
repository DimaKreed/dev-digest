#!/usr/bin/env bash
# This file exists ONLY to demonstrate that the skill importer never reads or
# runs executable content. Packing this folder into a .zip and importing it
# shows `scripts/detect.sh` listed as SKIPPED in the preview — its bytes are
# never even decompressed (see modules/skills/helpers.ts: the `unzipSync`
# filter admits .md and nothing else).
#
# A real skill has no executable part. A skill is text.
echo "If you can see this output, the importer is broken."
