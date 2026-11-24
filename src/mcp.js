// MCP (Model Context Protocol) endpoint so AI apps such as Claude Desktop can
// work with a user's data as tools. Each user connects with their own personal
// API key (created in their account), and the tools only see that user's data.
const express = require('express');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const auth = require('./auth');
const store = require('./store');

const collectionSchema = z.string().regex(store.COLLECTION_RE)
  .describe('Collection name: letters, numbers, _ or -, max 64 characters');
const idSchema = z.string().regex(store.UUID_RE).describe('Item id (UUID)');
const dataSchema = z.record(z.string(), z.any()).describe('JSON object with the item fields');

function result(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function notFound(id) {
  return { isError: true, content: [{ type: 'text', text: `No item with id ${id}` }] };
}

function buildServer(user) {
  const owner = user.id;
  const server = new McpServer({ name: 'cloud-data', version: '1.1.0' });

  server.registerTool('list_collections', {
    description: 'List every collection and how many items it holds.',
    inputSchema: {},
  }, async () => result(await store.listCollections(owner)));

  server.registerTool('list_items', {
    description: 'List items. Optionally filter by collection and by fields the item data must contain. Returns the total match count too.',
    inputSchema: {
      collection: collectionSchema.optional(),
      where: dataSchema.optional()
        .describe('Only return items whose data contains all these fields and values, e.g. {"status":"open"}'),
      sort: z.enum(['created_at', 'updated_at']).optional().describe('Sort field (default created_at)'),
      order: z.enum(['asc', 'desc']).optional().describe('Sort order (default desc, newest first)'),
      limit: z.number().int().min(1).max(500).optional().describe('Max items to return (default 50)'),
      offset: z.number().int().min(0).optional().describe('Number of items to skip'),
    },
  }, async (args) => result(await store.listItems(owner, args)));

  server.registerTool('get_item', {
    description: 'Get one item by id.',
    inputSchema: { id: idSchema },
  }, async ({ id }) => {
    const item = await store.getItem(owner, id);
    return item ? result(item) : notFound(id);
  });

  server.registerTool('create_item', {
    description: 'Create a new item in a collection.',
    inputSchema: { collection: collectionSchema, data: dataSchema },
  }, async ({ collection, data }) => result(await store.createItem(owner, collection, data)));

  server.registerTool('create_items', {
    description: `Create many items in one collection at once (up to ${store.MAX_BULK}).`,
    inputSchema: {
      collection: collectionSchema,
      items: z.array(dataSchema).min(1).max(store.MAX_BULK),
    },
  }, async ({ collection, items }) => {
    const created = await store.createItems(owner, collection, items);
    return result({ created: created.length, ids: created.map((i) => i.id) });
  });

  server.registerTool('update_item', {
    description: 'Update an item. By default the given fields are merged into its data; set replace to true to overwrite all of its data.',
    inputSchema: {
      id: idSchema,
      data: dataSchema,
      replace: z.boolean().optional().describe('Overwrite all data instead of merging (default false)'),
    },
  }, async ({ id, data, replace }) => {
    const item = replace ? await store.replaceItem(owner, id, data) : await store.mergeItem(owner, id, data);
    return item ? result(item) : notFound(id);
  });

  server.registerTool('delete_item', {
    description: 'Permanently delete an item by id.',
    inputSchema: { id: idSchema },
    annotations: { destructiveHint: true },
  }, async ({ id }) => ((await store.deleteItem(owner, id)) ? result({ deleted: id }) : notFound(id)));

  return server;
}

function createMcpRouter() {
  const router = express.Router();

  // Only personal API keys are accepted here, not browser login sessions.
  router.use(auth.authenticate(['api_key']));

  // Stateless mode: a fresh server and transport for every request.
  router.post('/', async (req, res, next) => {
    try {
      const server = buildServer(req.user);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      next(err);
    }
  });

  router.all('/', (req, res) => {
    res.status(405).set('Allow', 'POST').json({ error: 'Method not allowed' });
  });

  return router;
}

module.exports = { createMcpRouter };
