---
name: code-best-practices
description: Implement or review application code with explicit behavior, ownership, error handling, and risk-focused verification. Use for non-trivial code changes and reviews; defer to more specific project or domain skills when present.
---

# Code Best Practices

Use this skill to make changes that are understandable, bounded, and testable.

## Before Changing Code

- Identify the observable behavior, its callers, and the owner of the relevant state.
- Read the nearest implementation, types, tests, and configuration before introducing an abstraction or dependency.
- Preserve established patterns unless they demonstrably prevent the required behavior.

## General Design Principles

Apply these principles in proportion to the change. Repository architecture and explicit user requirements take precedence.

- **SOLID:** keep each unit focused on one reason to change; extend behavior through stable abstractions when real variation exists; preserve substitutability; keep interfaces narrow; depend on the abstraction that the consumer needs rather than a concrete implementation.
- **GRASP:** assign behavior to the information expert, use controllers as the boundary for application workflows, and prefer high cohesion with low coupling. Introduce indirection only when it reduces a concrete dependency.
- **KISS:** choose the smallest clear design that meets the current requirement. Prefer straightforward control flow and local patterns over cleverness.
- **DRY:** remove meaningful duplication of domain rules, workflows, and invariants. Do not extract coincidental similarity into a shared abstraction.
- **YAGNI:** do not add extension points, configuration, APIs, abstractions, or defensive behavior for hypothetical future needs.
- **Separation of concerns:** keep presentation, state, domain workflows, persistence/API access, and route lifecycle concerns at their established boundaries.
- **Composition over inheritance:** compose small focused services, functions, and components by default; use inheritance only for a genuine shared contract or behavior.
- **Least surprise:** match established repository naming, structure, APIs, and control flow so code behaves as a maintainer expects.
- **Fail fast at boundaries:** validate external, route, and nullable inputs where they enter a workflow; return safely or report a clear error before invalid state propagates.
- **Rule of three:** wait for a third meaningful use before extracting a reusable abstraction, unless an existing repository pattern or public contract already requires one.

## Implementation

- Keep business decisions separate from transport, storage, UI, and process-lifecycle concerns where that separation makes failure handling or testing clearer.
- Validate and normalize untrusted input at the boundary. Do not pass unchecked external data into persistence, shell commands, queries, or side-effecting APIs.
- Make failure behavior explicit. Return or surface useful errors; do not silently discard errors, use broad catches as control flow, or report success before a required operation is confirmed.
- Choose names that express intent and keep one source of truth for mutable state. Avoid speculative abstractions and unrelated refactors.
- Preserve backwards compatibility for public APIs and persisted data unless the requested change explicitly alters the contract.
- Separate adjacent functions and methods with one blank line to keep implementation boundaries easy to scan.

## Verification

- Add or update focused tests for changed behavior, especially validation, error handling, state transitions, and regressions.
- Run the narrowest meaningful verification first, then the repository's standard checks when the change warrants them.
- In reviews, report functional defects, security risks, regressions, and missing tests before style observations.
