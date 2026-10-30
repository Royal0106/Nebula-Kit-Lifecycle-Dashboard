I focused the dashboard on paid orders that require kits. I left test orders, cancelled orders, refunded orders and upload‑only orders out of the metrics. I used the export date to calculate orders so that the results stay the same every time a user opens the app. I also removed events and tracked replacement kits separately so that the timelines for replacement kits stay clear.

With time I will test more unusual event sequences and make it easier to understand where data is missing or conflicting. I will also check the layout more thoroughly.

I used Cursor to build the interface and draft the data‑processing logic. One mistake that Cursor made was calculating a replacement kit’s shipping delay, from the order date. I changed that to use the replacement event date because the original calculation made the replacement kit look overdue for longer than it really was.
