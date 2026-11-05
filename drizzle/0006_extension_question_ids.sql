-- Questions are now named by extension: the core triggers' questions move from
-- "flaky-test" to "core:flaky-test". Runs' stored decisions and configs keep the
-- old shape and are read by the engine's storedDecision / storedConfig.
UPDATE `asks` SET `question_id` = 'core:' || `question_id` WHERE instr(`question_id`, ':') = 0;
