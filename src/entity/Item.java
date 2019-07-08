package entity;

import java.util.Set;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
// 用户传来的数据 不稳定 可能只输入两个 可能只输入 三个 或者 两个不一样的 所以只通过构造函数来创建是不好的 所以我们引入了builderpatter
//aka 工厂方法 当一个函数的成员变量 参数比较多的时候 避免使用构造函数来创建的时候  就用工厂方法 

// 静态内部类 不做一个单独的新的class 因为我们要访问这些参数
public class Item {
// item里的每一个filed 都是json里的讯息 都是private 因为不希望别人乱改
	private String itemId;
	private String name;
	private double rating;
	private String address;
	private Set<String> categories;
	private String imageUrl;
	private String url;
	private double distance;
	
	private Item(ItemBuilder builder) {
		this.itemId = builder.itemId;
		this.name = builder.name;
		this.rating = builder.rating;
		this.address = builder.address;
		this.categories = builder.categories;
		this.imageUrl = builder.imageUrl;
		this.url = builder.url;
		this.distance = builder.distance;
	}
	
	public String getItemId() {
		return itemId;
	}
	public String getName() {
		return name;
	}
	public double getRating() {
		return rating;
	}
	public String getAddress() {
		return address;
	}
	public Set<String> getCategories() {
		return categories;
	}
	public String getImageUrl() {
		return imageUrl;
	}
	public String getUrl() {
		return url;
	}
	public double getDistance() {
		return distance;
	}
	
// itembuilder是一个builder pattern 把set的过程 和 get的过程 分割开来 因为我们希望item建立还以后 不希望别人改动
// 所以用itembuiderl set好信息 一旦变成item 就不能在修改 ！！ 这是一个builderpattern 同时这个还能防止constructor里的 输入顺序不一致
// 防止写多个constructor ！！！
	public static class ItemBuilder {
		private String itemId;
		private String name;
		private double rating;
		private String address;
		private Set<String> categories;
		private String imageUrl;
		private String url;
		private double distance;
	
	public ItemBuilder setItemId(String itemId) {
		this.itemId = itemId;
		return this;
	}
	public ItemBuilder setName(String name) {
		this.name = name;
		return this;
	}
	public ItemBuilder setRating(double rating) {
		this.rating = rating;
		return this;
	}
	public ItemBuilder setAddress(String address) {
		this.address = address;
		return this;
	}
	public ItemBuilder setCategories(Set<String> categories) {
		this.categories = categories;
		return this;
	}
	public ItemBuilder setImageUrl(String imageUrl) {
		this.imageUrl = imageUrl;
		return this;
	}
	public ItemBuilder setUrl(String url) {
		this.url = url;
		return this;
	}
	public ItemBuilder setDistance(double distance) {
		this.distance = distance;
		return this;
	}
	public Item build() {
		return new Item(this);
	}
}

	
	// 把item 这个format 变成json的形式 因为最后要往回去传 或者mongodb的使用需要json
	public JSONObject toJSONObject() {
		JSONObject obj = new JSONObject();
		try {
			obj.put("item_id", itemId);
			obj.put("name", name);
			obj.put("rating", rating);
			obj.put("address", address);
			obj.put("categories", new JSONArray(categories));
			obj.put("image_url", imageUrl);
			obj.put("url", url);
			obj.put("distance", distance);
		} catch (JSONException e) {
			e.printStackTrace();
		}
		return obj;
	}

}
