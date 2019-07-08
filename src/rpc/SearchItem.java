package rpc;

import java.io.IOException;
import java.util.List;
import java.util.Set;

import javax.servlet.ServletException;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;

//import org.apache.jasper.tagplugins.jstl.core.Set;
import org.json.JSONArray;
import org.json.JSONObject;

import db.DBConnection;
import db.DBConnectionFactory;
import entity.Item;

/**
 * Servlet implementation class SearchItem
 */
@WebServlet("/search")
public class SearchItem extends HttpServlet {
	private static final long serialVersionUID = 1L;
       
    /**
     * @see HttpServlet#HttpServlet()
     */
    public SearchItem() {
        super();
        // TODO Auto-generated constructor stub
    }

	/**
	 * @see HttpServlet#doGet(HttpServletRequest request, HttpServletResponse response)
	 */
	/*protected void doGet(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
		/*response.setContentType("text/html");// 告诉前端我返回的是什么类型的数据 返回的是html的字符串
		PrintWriter out = response.getWriter();
		if (request.getParameter("username") != null) {
			String username = request.getParameter("username");
		
		
		out.println("<html><body>");
		out.println("<h1>Hello" + username + "</h1>");
		out.println("</body></html>");
		}*/
		
		/*response.setContentType("application/json");
		PrintWriter out = response.getWriter();
		
		if (request.getParameter("username") != null) {
			String username = request.getParameter("username");
			JSONObject obj = new JSONObject();
			try {
				obj.put("instructor", new JSONObject().put("username",username));// key必须是字符串  value可以是各种类型的数据这里是JSON object
				obj.put("username",username);
				obj.put("company","laioffer");// 这两个key value pair是平行的
			} catch (JSONException e) {
				e.printStackTrace();
			}
			out.print(obj);
		}*/
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
			throws ServletException, IOException {
    	
    	HttpSession session = request.getSession(false);
		if (session == null) {
			response.setStatus(403);
			return;
		}
		
		String userId = session.getAttribute("user_id").toString();

		double lat = Double.parseDouble(request.getParameter("lat"));
		double lon = Double.parseDouble(request.getParameter("lon"));
		String term = request.getParameter("term");

		
		 DBConnection connection = DBConnectionFactory.getConnection();
           try { 
        	   List<Item> items = connection.searchItems(lat, lon, term);
        	   Set<String> favoritedItemIds = connection.getFavoriteItemIds(userId);

        	   JSONArray array = new JSONArray();
        	   for (Item item : items) {
        		   JSONObject obj = item.toJSONObject();
   				obj.put("favorite", favoritedItemIds.contains(item.getItemId()));
   				array.put(obj);

        	   }
        	   RpcHelper.writeJsonArray(response, array);

           		} catch (Exception e) {
           			e.printStackTrace();
           		} finally {
           			connection.close();
           		}

      /*  TicketMasterAPI tmAPI = new TicketMasterAPI();
   		List<Item> items = tmAPI.search(lat, lon, null);
		JSONArray array = new JSONArray();
		for (Item item : items) {
			array.put(item.toJSONObject());
		}
		RpcHelper.writeJsonArray(response, array);*/
	}

		
		//response.setContentType("application/json");
		//PrintWriter writer = response.getWriter();
		
		/*JSONArray array = new JSONArray();
		try {
			array.put(new JSONObject().put("username", "abcd"));
			array.put(new JSONObject().put("username", "1234"));
		} catch (JSONException e) {
			// TODO Auto-generated catch block
			e.printStackTrace();
		}
		//writer.print(array);
		//writer.close();
		RpcHelper.writeJsonArray(response, array);
	}*/

		
		
		
		//out.close();
		// TODO Auto-generated method stub
		//response.getWriter().append("Served at: ").append(request.getContextPath());
	//}

	/**
	 * @see HttpServlet#doPost(HttpServletRequest request, HttpServletResponse response)
	 */
	protected void doPost(HttpServletRequest request, HttpServletResponse response) throws ServletException, IOException {
		// TODO Auto-generated method stub
		doGet(request, response);
	}

}
