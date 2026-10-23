import { getBoard, route } from '../lib/store.js';

export default route(async (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=5');
  res.json({ board: await getBoard() });
});
