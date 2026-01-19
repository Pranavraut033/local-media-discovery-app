# agents.md

## Copilot Agent Roles & Responsibilities

### Purpose
The Copilot agent automates the implementation of the local-media-discovery-app, following the PRD and plan.md. It ensures:
- Strict adherence to DRY and library-first principles
- Incremental, testable delivery
- Updates to documentation (PRD.md, plan.md, agents.md) only

### Execution Phases
- Follows the phased plan in plan.md
- Prefers existing libraries for all features
- Avoids custom code where robust libraries exist

### Boundaries
- No creation of new markdown files (except plan.md, agents.md)
- No external network calls or telemetry
- All data and logic remain local

### Documentation
- Updates PRD.md with architecture and decisions
- Maintains plan.md for phased execution
- Updates agents.md for agent-specific instructions

### Usage Patterns
- Each phase is implemented and validated before proceeding
- Documentation is updated after each phase
- Agent actions are transparent and traceable

---

## Change Log
- 2026-01-19: Initial agent documentation created for phased, library-first, DRY implementation.
