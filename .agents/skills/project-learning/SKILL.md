---
name: project-learning
description: Apply confirmed lessons from prior agent mistakes when working in the Rust+ Control project. Use for any implementation, review, investigation, or configuration change in this repository; do not use outside this project.
---

# Project Learning

Before making a change in this repository, read [the lessons log](references/lessons.md). Apply entries whose scope matches the task.

## Recording a lesson

When the user, a test, a review, or direct verification establishes that an agent action was wrong, add one concise entry to the lessons log before finishing the task.

- Record the observable mistake, its context, the required future behavior, and the evidence that established it.
- Phrase the rule so it applies only to the demonstrated situation. Do not promote preferences, unverified suspicions, or one-off failures into universal restrictions.
- Update an existing entry when it describes the same underlying issue; otherwise add a new entry.
- Do not add entries for mistakes that were caught and corrected before they affected code, behavior, or the user's workflow.

Keep the log concise and factual. Its purpose is to prevent repeated project-specific errors, not to preserve a conversation history.
