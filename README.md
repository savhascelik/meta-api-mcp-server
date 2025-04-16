# Meta API MCP Server

A meta API Gateway server that works with the Model Context Protocol (MCP). You can connect any API to LLMs (Claude, GPT, etc.) through MCP. This enables AI assistants to interact directly with APIs and access real-world data sources.

## Features

- 🔄 Multi-API support: Manage multiple APIs through a single server
- 🛠️ Easily add APIs with JSON configuration files
- 📋 Automatically convert Postman Collections to MCP tools
- 🔌 Comprehensive support for HTTP APIs (GET, POST, PUT, DELETE, PATCH)
- 🔒 Various authentication methods (API Key, Bearer Token)
- 📁 Load configurations from local files or remote URLs
- 📑 Support for configuration file lists

## Installation

### Global Installation with NPM (Recommended)

```bash
npm install -g meta-api-mcp-server
```

### Installation from Source Code

```bash
git clone https://github.com/savhascelik/meta-api-mcp-server.git
cd metamcp
npm install
```

## Usage

### As a Command Line Tool

```bash
# Load from default api-configs/ folder
meta-mcp

# Specify a configuration file (in the directory where you run the server, there should be a folder with this name and structured json in it)
meta-mcp path/to/config.json

# Load from a specific folder
meta-mcp path/to/configs/

# Load from a remote URL
meta-mcp https://example.com/api-config.json

# Load from a remote configuration list
meta-mcp https://example.com/config-list.json

# Load from a Postman Collection ( your filename must contain the word ‘postman’, I'll bind it to a variable when I have time )
meta-mcp path/to/My-API.postman_collection.json
```

### Using with Cursor or Other MCP Clients

To connect to an MCP client like Cursor, configure your `mcp.json` file as follows:

```json
{
  "mcpServers": {
    "myApiServer": { 
      "command": "meta-mcp",
      "args": [
        "path/to/api-config.json"
      ],
      "env": {
        "EXAMPLE_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Postman Collection Conversion

Using your existing Postman collections with Meta API MCP Server is now very easy! You can use hundreds of ready-made APIs without writing a single line of code.

1. Export your Postman collection (in v2.1.0 format)
2. Start Meta API MCP Server with the collection file:

```bash
meta-mcp my-collection.postman_collection.json
```

3. The server will automatically:
   - Analyze all endpoints
   - Detect the authentication method
   - Extract path/query parameters
   - Analyze request body structure
   - Create MCP tools

4. Add your API key to the `.env` file (the server will tell you which environment variable to use)

### Supported Postman Collection Features

- ✅ Multi-level folder structure
- ✅ Bearer token authentication
- ✅ API Key authentication
- ✅ Path parameters
- ✅ Query parameters
- ✅ Headers
- ✅ JSON request body
- ✅ Postman variables (like {{api_url}})

## Project Structure

The codebase is organized in a modular way to facilitate maintenance and extension:

```
meta-api-mcp-server/
├── src/
│   ├── index.js            # Main entry point
│   ├── converters/         # Format converters
│   │   └── postman.js      # Postman to MCP converter
│   ├── handlers/           # Request handlers
│   │   └── http-handler.js # HTTP API handler
│   └── lib/                # Utility modules
│       └── config-loader.js # Configuration loader
├── api-configs/            # Default config directory
└── package.json
```

## API Configuration File Format

You can manually configure APIs using the following JSON format:

```json
{
  "apiId": "my-api",
  "handlerType": "httpApi",
  "baseUrl": "https://api.example.com",
  "authentication": {
    "type": "bearerToken",
    "envVariable": "MY_API_TOKEN"
  },
  "endpoints": [
    {
      "mcpOperationId": "getUsers",
      "description": "Get a list of users",
      "targetPath": "/users",
      "targetMethod": "GET",
      "parameters": [
        {
          "name": "page",
          "in": "query",
          "required": false,
          "type": "integer",
          "description": "Page number"
        }
      ]
    }
  ]
}
```

## License

MIT 