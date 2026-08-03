/* Compatibility shim. CreateSkillModal moved to src/components/CreateSkillModal/
   (a second route — /repos/:repoId/conventions — now opens it, and one route's
   _components/ is not an import target for another route).

   `SKILL_TYPES` is still deep-imported from here by ImportSkillDrawer and by
   SkillEditor/_components/ConfigTab. Re-export rather than duplicate, so there
   stays exactly one list. Delete this file once those two imports point at
   "@/components/CreateSkillModal/constants". */
export { DEFAULT_TYPE, MODAL_WIDTH, SKILL_TYPES } from "@/components/CreateSkillModal/constants";
