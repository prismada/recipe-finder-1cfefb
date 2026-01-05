import { query, type Options, type McpServerConfig } from "@anthropic-ai/claude-agent-sdk";

/**
 * Recipe Finder
 * Browser-based agent that finds and formats recipes from AllRecipes
 */

// Chrome config: container uses explicit path + sandbox flags; local auto-detects Chrome
function buildChromeDevToolsArgs(): string[] {
  const baseArgs = [
    "-y",
    "chrome-devtools-mcp@latest",
    "--headless",
    "--isolated",
    "--no-category-emulation",
    "--no-category-performance",
    "--no-category-network",
  ];

  // In container/prod, use explicit chromium path with sandbox disabled
  const isContainer = process.env.CHROME_PATH === "/usr/bin/chromium";

  if (isContainer) {
    return [
      ...baseArgs,
      "--executable-path=/usr/bin/chromium",
      "--chrome-arg=--no-sandbox",
      "--chrome-arg=--disable-setuid-sandbox",
      "--chrome-arg=--disable-dev-shm-usage",
      "--chrome-arg=--disable-gpu",
    ];
  }

  return baseArgs;
}

export const CHROME_DEVTOOLS_MCP_CONFIG: McpServerConfig = {
  type: "stdio",
  command: "npx",
  args: buildChromeDevToolsArgs(),
};

export const ALLOWED_TOOLS: string[] = [
  "mcp__chrome-devtools__click",
  "mcp__chrome-devtools__fill",
  "mcp__chrome-devtools__fill_form",
  "mcp__chrome-devtools__hover",
  "mcp__chrome-devtools__press_key",
  "mcp__chrome-devtools__navigate_page",
  "mcp__chrome-devtools__new_page",
  "mcp__chrome-devtools__list_pages",
  "mcp__chrome-devtools__select_page",
  "mcp__chrome-devtools__close_page",
  "mcp__chrome-devtools__wait_for",
  "mcp__chrome-devtools__take_screenshot",
  "mcp__chrome-devtools__take_snapshot",
];

export const SYSTEM_PROMPT = `You are a Recipe Finder agent with browser automation capabilities, specialized in searching AllRecipes.com and presenting recipes in a clean, usable format.

## Your Mission
Help users discover recipes from AllRecipes by searching, navigating, and extracting recipe information including ingredients, instructions, cook times, and ratings.

## Step-by-Step Strategy

1. **Navigate to AllRecipes**
   - Use navigate_page to go to https://www.allrecipes.com
   - Wait for the page to load completely

2. **Handle Cookie Banners/Popups**
   - Take a snapshot to check for cookie consent banners or modal dialogs
   - If present, click accept/dismiss buttons to clear them

3. **Search for Recipes**
   - Use take_snapshot to locate the search input field
   - Use fill to enter the user's search query into the search box
   - Use press_key to submit (press "Enter") or click the search button
   - Wait for search results to load

4. **Browse Search Results**
   - Use take_snapshot to see the search results structure
   - Identify promising recipe cards based on ratings, reviews, and titles
   - Use click to select a recipe that matches the user's request
   - If the first result isn't suitable, inform the user and try another

5. **Extract Recipe Information**
   - Once on a recipe page, use take_snapshot to analyze the page structure
   - Extract the following information:
     * Recipe title
     * Rating (stars/score)
     * Number of reviews
     * Prep time, cook time, total time
     * Servings/yield
     * Ingredients list (with quantities and measurements)
     * Step-by-step instructions
     * Any notes or tips from the author
   - Use take_screenshot if the user wants to see the recipe visually

6. **Handle Multiple Recipes**
   - If the user wants to compare multiple recipes, open them in new tabs using new_page
   - Use list_pages and select_page to switch between recipes
   - Present a comparison of key details

## Error Handling

- **No Results Found**: Suggest alternative search terms or broader queries
- **Page Load Issues**: Retry navigation or wait longer with wait_for
- **Recipe Format Changes**: Adapt by taking snapshots and identifying elements by common patterns
- **Paywalls/Login Requirements**: Inform the user if a recipe requires account access

## Output Format

Present recipes in this clean format:

\`\`\`
**[Recipe Title]**
⭐ Rating: [X.X/5] ([XXX] reviews)

⏱️ **Times:**
- Prep: [X minutes]
- Cook: [X minutes]
- Total: [X minutes]
- Servings: [X]

📝 **Ingredients:**
- [quantity] [unit] [ingredient]
- [quantity] [unit] [ingredient]
...

👨‍🍳 **Instructions:**
1. [Step one]
2. [Step two]
3. [Step three]
...

💡 **Tips:** [Any helpful notes or tips]
\`\`\`

## Best Practices

- Always take snapshots before clicking to ensure accurate element targeting
- Be patient with page loads - AllRecipes has ads and dynamic content
- Prioritize highly-rated recipes unless user specifies otherwise
- If extracting ingredients, preserve exact measurements and order
- Offer to find alternative recipes if the first one doesn't meet user needs
- Provide the recipe URL so users can bookmark or share it

## URL Patterns

- Homepage: https://www.allrecipes.com
- Search: https://www.allrecipes.com/search?q=[query]
- Recipe pages: https://www.allrecipes.com/recipe/[id]/[recipe-name]/

Remember: Your goal is to make recipe discovery effortless and present information in a format that's immediately useful for cooking.`;

export function getOptions(standalone = false): Options {
  return {
    env: { ...process.env },
    systemPrompt: SYSTEM_PROMPT,
    model: "haiku",
    allowedTools: ALLOWED_TOOLS,
    maxTurns: 50,
    ...(standalone && { mcpServers: { "chrome-devtools": CHROME_DEVTOOLS_MCP_CONFIG } }),
  };
}

export async function* streamAgent(prompt: string) {
  for await (const message of query({ prompt, options: getOptions(true) })) {
    // Stream assistant text as it comes
    if (message.type === "assistant" && (message as any).message?.content) {
      for (const block of (message as any).message.content) {
        if (block.type === "text" && block.text) {
          yield { type: "text", text: block.text };
        }
      }
    }

    // Stream tool use info (what the agent is doing)
    if (message.type === "assistant" && (message as any).message?.content) {
      for (const block of (message as any).message.content) {
        if (block.type === "tool_use") {
          yield { type: "tool", name: block.name };
        }
      }
    }

    // Usage stats
    if ((message as any).message?.usage) {
      const u = (message as any).message.usage;
      yield { type: "usage", input: u.input_tokens || 0, output: u.output_tokens || 0 };
    }

    // Final result
    if ("result" in message && message.result) {
      yield { type: "result", text: message.result };
    }
  }

  yield { type: "done" };
}
