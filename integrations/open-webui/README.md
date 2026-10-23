# AI Stupid Level for Open WebUI

Stop choosing AI models manually. Let live benchmarks choose the best model for coding, reasoning, or agent tasks—using your own provider keys, with zero token markup.

This [Open WebUI Function](https://docs.openwebui.com/features/extensibility/plugin/functions/pipe) (a manifold pipe) adds the [AI Stupid Level](https://aistupidlevel.info/router) Smart Router. Each routing mode becomes a model. A request goes to the model that currently scores best on AI Stupid Level's continuously re-run benchmarks, and the router calls it with the provider keys saved on your AI Stupid Level account.

What it adds over a plain OpenAI connection:

- **Routing modes as named models**, such as "AI Stupid Level: Best for coding" (`auto-coding`) and "Best for tool use" (`auto-tooling`), plus single models you can pin.
- **Which model answered, and why**, above every reply. For example: `AI Stupid Level → gpt-5.6-luna (tied for first on coding, cheapest)`. Click the line to read the router's full reason: the score, the models it was tied with and the measured cost. The line comes from the `X-AISM-Model` and `X-AISM-Reasoning` response headers.
- **One key for everyone, or a key per person.** An admin sets a shared router key, and any user can add their own in **Valves** to use their own account and provider keys.
- **A plain answer for images.** The router routes text only, so a message with an image gets an explanation, and nothing is sent.
- **A sandbox switch** that keeps the real routing decisions but returns mock answers, so nothing is billed while you check the setup.

Requires Open WebUI 0.5.17 or later. Tested on 0.5.17 and 0.12.3.

## Install

1. In Open WebUI, go to **Admin Panel → Functions**. Open the menu next to **Create**, choose **Import from URL**, and paste:

   ```
   https://raw.githubusercontent.com/StudioPlatforms/aistupidlevel-sdk/main/integrations/open-webui/aistupidlevel.py
   ```

   The GitHub page link also works. Read the code, click **Save**, and switch the function on.
2. Create a router key (it starts with `aism_`) at https://aistupidlevel.info/router/keys. Add your provider keys at https://aistupidlevel.info/router/providers.
3. Click the **Valves** button on the function's row, paste the key into `API_KEY`, and save. You can also leave it empty and let each user add their own key (step 5).
4. Admins see the models straight away. To show them to other users, go to **Admin Panel → Settings → Models** and make the AI Stupid Level models **Public**, or give groups access.
5. Each user can add their own key with the **Valves** button next to the message box. The button appears when an AI Stupid Level model is selected.

You can also paste the file into **Admin Panel → Functions → Create**.

## Models

| Model | Mode | Each request goes to |
|---|---|---|
| Default (your saved strategy) | `auto` | the strategy saved in your [preferences](https://aistupidlevel.info/router/preferences) |
| Best for coding / reasoning / tool use | `auto-coding`, `auto-reasoning`, `auto-tooling` | the best measured score on that benchmark |
| Best overall | `auto-best` | the best combined score |
| Best value (overall, or for coding / reasoning / tool use) | `auto-value`, `auto-value-coding`, `auto-value-reasoning`, `auto-value-tooling` | the most benchmark points per measured dollar, among models within 5 points of the best |
| Fastest near the top | `auto-fastest-quality` | the fastest model within 5 points of the best |
| Cheapest / Fastest / Most consistent | `auto-cheapest`, `auto-fastest`, `auto-consistent` | the cheapest, fastest or steadiest model |
| Per request | `auto-task` | a strategy picked from the request's content |
| Your split | `auto-split` | your own weighted split, set in preferences |

When the leaders are statistically tied, the router picks the cheapest by default. You can choose fastest or highest score instead in your preferences. Use **Best for coding** for code and **Best for tool use** when the chat uses tools. Models listed as `(pinned)` skip routing. The routing modes are described at https://aistupidlevel.info/router/docs#strategies.

## Valves

| Valve | Default | Purpose |
|---|---|---|
| `BASE_URL` | `https://aistupidlevel.info/v1` | Smart Router endpoint |
| `API_KEY` | empty | Shared router key. When empty, the `AISTUPIDLEVEL_API_KEY` environment variable is used. |
| `NAME_PREFIX` | `AI Stupid Level: ` | Text before each model name |
| `SHOW_PINNED_MODELS` | on | List single models as well as routing modes |
| `SHOW_STATUS` | on | Show which model answered, and why |
| `SANDBOX` | off | Mock answers, nothing billed |

The user valve `API_KEY` is a user's own router key, and it overrides the shared one.

## Good to know

- **What is sent:** only the OpenAI request fields the router reads (messages, tools, sampling parameters and response format) go to `BASE_URL`. Open WebUI's own metadata is not sent. The router key is never logged or shown.
- **Billing:** the router calls the chosen model with your provider key, so the provider bills you directly. AI Stupid Level adds zero token markup.
- **Tools:** tool calls pass through natively, so Open WebUI's tools work, and the router keeps a tool-calling conversation on one model. In native function calling, Open WebUI 0.12 also offers its built-in tools (notes, knowledge, calendar and others) to every model, and they are sent like any other tool.
- **Background tasks** (chat titles, tags and follow-up suggestions) use the chat's model unless you set a **Task Model** in **Admin Panel → Settings → Interface**. They show no status line.

## Publishing on openwebui.com (maintainers)

1. Sign in at https://openwebui.com with the AI Stupid Level account.
2. In an Open WebUI instance where you are an admin, install the function with **Import from URL** as above, so its id is `aistupidlevel`. You don't need to set the Valves. Their values are never shared.
3. In **Admin Panel → Functions**, open the function's menu and click **Share**. openwebui.com opens a new post with the function filled in. Nothing is published until you finish the post.
4. Use the title **AI Stupid Level**, paste the listing text below as the description, and add the square icon if the form takes media. Then post it.
5. Check the post: click **Get**, import it into an instance, and confirm the models appear.

When the code changes, bump `version` in the header and `VERSION` in the code, push to `main`, and update the post on openwebui.com.

Listing text:

```markdown
Stop choosing AI models manually. Let live benchmarks choose the best model for coding, reasoning, or agent tasks—using your own provider keys, with zero token markup.

Adds the [AI Stupid Level](https://aistupidlevel.info/router) Smart Router to Open WebUI:

- each routing mode (Best for coding, Best for tool use, Best for reasoning, Best value, Per request and more) is its own model, and single models can be pinned;
- a status line above every reply names the model that answered and why; click it for the full reason;
- an admin sets a shared router key, or each user adds their own in Valves;
- a message with an image gets a plain explanation, because the router routes text only, and nothing is sent.

Setup: create a router key (`aism_...`) at https://aistupidlevel.info/router/keys, add your provider keys at https://aistupidlevel.info/router/providers, and paste the router key into this function's Valves.

Source and issues: https://github.com/StudioPlatforms/aistupidlevel-sdk/tree/main/integrations/open-webui
```

## Licence

MIT. Source: https://github.com/StudioPlatforms/aistupidlevel-sdk/tree/main/integrations/open-webui
