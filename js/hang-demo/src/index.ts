import "./highlight";
import "@moq/hang-ui/watch/element";

import HangSupport from "@moq/hang/support/element";
import HangWatch from "@moq/hang/watch/element";
import * as Moq from "@moq/lite";

export { HangSupport, HangWatch };

// Get DOM elements
const watch = document.querySelector("hang-watch") as HangWatch | undefined;
if (!watch) throw new Error("unable to find <hang-watch> element");

const form = document.getElementById("config-form") as HTMLFormElement;
const relayUrlInput = document.getElementById("relay-url") as HTMLInputElement;
const broadcastSelect = document.getElementById("broadcast-select") as HTMLSelectElement;
const discoverBtn = document.getElementById("discover-btn") as HTMLButtonElement;
const discoverStatus = document.getElementById("discover-status") as HTMLElement;

// If query params are provided, use them
const urlParams = new URLSearchParams(window.location.search);
const pathParam = urlParams.get("path");
const urlParam = urlParams.get("url");

if (pathParam) {
	watch.setAttribute("path", pathParam);
}

if (urlParam) {
	watch.setAttribute("url", urlParam);
	relayUrlInput.value = urlParam;
}

// Track active discovery connection so we can close it
let discoveryConnection: Moq.Connection.Established | null = null;

/**
 * Discovers broadcasts from a relay using the MoQ announced() API.
 * This uses SUBSCRIBE_NAMESPACE to get a list of available broadcasts.
 */
async function discoverBroadcasts(relayUrl: string): Promise<string[]> {
	// Close any existing discovery connection
	if (discoveryConnection) {
		discoveryConnection.close();
		discoveryConnection = null;
	}

	const url = new URL(relayUrl);
	const broadcasts: string[] = [];

	try {
		// Connect to the relay
		const connection = await Moq.Connection.connect(url);
		discoveryConnection = connection;

		// Subscribe to announcements (empty prefix = all broadcasts)
		const announced = connection.announced(Moq.Path.empty());

		// Collect broadcasts with a timeout
		const timeout = 3000; // 3 seconds
		const startTime = Date.now();

		while (Date.now() - startTime < timeout) {
			// Race between next announcement and timeout
			const timeoutPromise = new Promise<undefined>((resolve) =>
				setTimeout(() => resolve(undefined), timeout - (Date.now() - startTime)),
			);

			const entry = await Promise.race([announced.next(), timeoutPromise]);

			if (entry === undefined) {
				// Timeout reached
				break;
			}

			if (entry.active) {
				broadcasts.push(entry.path);
			}
		}

		// Close the announced subscription but keep connection for potential reuse
		announced.close();
	} catch (err) {
		console.error("Discovery error:", err);
		throw err;
	}

	return broadcasts;
}

// Handle discover button click
discoverBtn.addEventListener("click", async () => {
	const relayUrl = relayUrlInput.value.trim();
	if (!relayUrl) {
		discoverStatus.textContent = "Please enter a relay URL";
		discoverStatus.className = "error";
		return;
	}

	discoverBtn.disabled = true;
	discoverStatus.textContent = "Discovering broadcasts...";
	discoverStatus.className = "";
	broadcastSelect.disabled = true;

	try {
		const broadcasts = await discoverBroadcasts(relayUrl);

		// Update the select dropdown
		broadcastSelect.innerHTML = "";

		if (broadcasts.length === 0) {
			const option = document.createElement("option");
			option.value = "";
			option.textContent = "-- No broadcasts found --";
			broadcastSelect.appendChild(option);
			discoverStatus.textContent = "No broadcasts found. Is anything publishing?";
			discoverStatus.className = "error";
		} else {
			// Add a placeholder option
			const placeholder = document.createElement("option");
			placeholder.value = "";
			placeholder.textContent = `-- Select from ${broadcasts.length} broadcast(s) --`;
			broadcastSelect.appendChild(placeholder);

			// Add each discovered broadcast
			for (const broadcast of broadcasts) {
				const option = document.createElement("option");
				option.value = broadcast;
				option.textContent = broadcast;
				broadcastSelect.appendChild(option);
			}

			broadcastSelect.disabled = false;
			discoverStatus.textContent = `Found ${broadcasts.length} broadcast(s)`;
			discoverStatus.className = "success";
		}
	} catch (err) {
		console.error("Discovery failed:", err);
		broadcastSelect.innerHTML = '<option value="">-- Discovery failed --</option>';
		discoverStatus.textContent = `Error: ${err instanceof Error ? err.message : "Connection failed"}`;
		discoverStatus.className = "error";
	} finally {
		discoverBtn.disabled = false;
	}
});

// Handle form submission
form.addEventListener("submit", (e) => {
	e.preventDefault();

	const relayUrl = relayUrlInput.value.trim();
	const broadcast = broadcastSelect.value;

	if (!relayUrl) {
		discoverStatus.textContent = "Please enter a relay URL";
		discoverStatus.className = "error";
		return;
	}

	if (!broadcast) {
		discoverStatus.textContent = "Please enter or select a broadcast";
		discoverStatus.className = "error";
		return;
	}

	// Update the hang-watch element
	watch.setAttribute("url", relayUrl);
	watch.setAttribute("path", broadcast);

	// Update URL params for sharing
	const newUrl = new URL(window.location.href);
	newUrl.searchParams.set("url", relayUrl);
	newUrl.searchParams.set("path", broadcast);
	window.history.replaceState({}, "", newUrl.toString());

	discoverStatus.textContent = `Connected to ${broadcast}`;
	discoverStatus.className = "success";

	// Close discovery connection if open
	if (discoveryConnection) {
		discoveryConnection.close();
		discoveryConnection = null;
	}
});

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
	if (discoveryConnection) {
		discoveryConnection.close();
	}
});
