# NetConnect milestone 2 summary.

## Milestone 2: Authentication and role-based access control

This milestone adds:

- user registration with password hashing via bcrypt
- secure login and API-token issuance
- logout support via revokable tokens
- SQLite-backed session tracking
- role-based access control for administrators and normal users
- administrative suspension controls
- FastAPI routes for authenticated access
- tests that verify login, registration, and RBAC enforcement

The next milestone continues with the communication layer: private/group messaging, rooms, and user presence.
