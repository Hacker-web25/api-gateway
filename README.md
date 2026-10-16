# api-gateway

An API gateway built with Node.js, Express and Redis. It checks API keys and limits how many requests each client can send using a Token Bucket stored in Redis.

The demo runs across two laptops. Laptop B runs the gateway, the sample API and Redis. Laptop A sends requests to it over the network.

| Folder | What is in it |
| --- | --- |
| [backend](backend) | The gateway, the sample API, the sender script, the tests and the learning docs |
| [frontend](frontend) | The two screens, one for each laptop |

Start with [backend/README.md](backend/README.md), then [frontend/README.md](frontend/README.md).
