# Content automation

The VPS worker maintains a rolling daily calendar, prepares weekly video batches and schedules exact owner-approved releases through Buffer. The repository contains the worker, isolated renderer, reviewed template inputs and tests. The deployment provisions provider settings and runtime state separately.

- [Operating guide](MACHINE.md)
- [VPS runtime](vps/README.md)
- [Google review sync](GOOGLE-SYNC.md)
- [Buffer scheduling](BUFFER-MCP.md)

Run the content suite from the repository root with `python3 -m unittest discover -s marketing/content-library`. The VPS media-server suite requires local Docker and `RUN_MEDIA_SERVER_TESTS=1`.
